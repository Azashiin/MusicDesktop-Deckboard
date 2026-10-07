export const actions = ["play", "pause", "playPause", "next", "previous", "seek", "seekForward", "seekBackward", "volumeSet", "volumeUp", "volumeDown", "mute", "unmute", "toggleMute", "toggleMiniPlayer", "showMiniPlayer", "hideMiniPlayer", "toggleShuffle", "toggleRepeatOne", "toggleStreamerMode"];
export function connection(value) {
  if (!value || typeof value !== "object" || typeof value.token !== "string" || !/^[a-f0-9]{64}$/i.test(value.token)) throw new Error("Invalid connection");
  const url = new URL(value.origin);
  if (url.protocol !== "http:" || !["127.0.0.1", "localhost"].includes(url.hostname) || !url.port || Number(url.port) < 1024 || url.pathname !== "/" || url.search || url.hash || url.username || url.password) throw new Error("Localhost connection required");
  return { origin: url.origin, token: value.token, language: value.language === "en" ? "en" : "fr" };
}
/** Generic control client; contains no Stream Deck event or player implementation. */
export class ApiClient {
  constructor(config, onFrame, onConnection, dependencies = {}) {
    this.config = connection(config); this.onFrame = onFrame; this.onConnection = onConnection;
    this.WebSocket = dependencies.WebSocket; this.fetch = dependencies.fetch;
    if (!this.WebSocket || !this.fetch) throw new Error("Client transports required");
    this.socket = null; this.retry = null; this.watchdog = null; this.attempt = 0; this.closed = false;
  }
  start() {
    if (this.closed || this.socket) return;
    const url = new URL("/ws", this.config.origin); url.protocol = "ws:"; url.searchParams.set("token", this.config.token);
    const socket = new this.WebSocket(url.href, { maxPayload: 64 * 1024 }); this.socket = socket;
    this.watchdog = setTimeout(() => socket.terminate(), 8000);
    socket.on("open", () => { clearTimeout(this.watchdog); this.watchdog = null; this.attempt = 0; this.onConnection(true); });
    socket.on("message", bytes => {
      try { const frame = JSON.parse(bytes.toString()); if (frame.v !== 1) throw new Error("Invalid state"); this.onFrame(frame); }
      catch { socket.close(1008, "Invalid state"); }
    });
    socket.on("error", () => socket.terminate());
    socket.on("close", () => {
      clearTimeout(this.watchdog); this.watchdog = null; this.socket = null; this.onConnection(false);
      if (!this.closed) this.retry = setTimeout(() => { this.retry = null; this.start(); }, Math.min(15000, 500 * 2 ** this.attempt++));
    });
  }
  async command(action, value) {
    if (!actions.includes(action)) throw new Error("Invalid command");
    if (value !== undefined && (!Number.isFinite(value) || value < 0 || (action.startsWith("volume") ? value > 1 : action.startsWith("seek") ? value > 86400 : true))) throw new Error("Invalid value");
    if (["seek", "volumeSet"].includes(action) && value === undefined) throw new Error("Value required");
    const controller = new AbortController(); const timeout = setTimeout(() => controller.abort(), 8000);
    try {
      const response = await this.fetch(`${this.config.origin}/api/commands`, { method: "POST", redirect: "error", signal: controller.signal,
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${this.config.token}` }, body: JSON.stringify({ action, ...(value === undefined ? {} : { value }) }) });
      if (!response.ok) throw new Error(`Command rejected (${response.status})`);
    } finally { clearTimeout(timeout); }
  }
  close() { this.closed = true; clearTimeout(this.retry); clearTimeout(this.watchdog); const socket = this.socket; this.socket = null; if (socket) { socket.removeAllListeners(); socket.on("error", () => {}); socket.terminate(); } }
}
