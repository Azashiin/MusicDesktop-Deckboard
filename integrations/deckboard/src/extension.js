import { Extension, InputTypes, Platforms } from "deckboard-kit";
import WebSocket from "ws";
import { ApiClient, actions, connection } from "../../common/api-client.js";
import { buttonState } from "../../common/button-state.js";
import { localFetch } from "./local-fetch.js";

const key = action => `musicdesktop-${action}`;
const dynamic = new Set(["playPause", "toggleMute", "toggleMiniPlayer", "toggleShuffle", "toggleRepeatOne", "toggleStreamerMode"]);
const icons = {
  play: "play", pause: "pause", playPause: "play", next: "step-forward", previous: "step-backward",
  seek: "clock", seekForward: "forward", seekBackward: "backward", volumeSet: "volume-up", volumeUp: "volume-up", volumeDown: "volume-down",
  mute: "volume-mute", unmute: "volume-up", toggleMute: "volume-mute", toggleMiniPlayer: "window-restore", showMiniPlayer: "window-restore", hideMiniPlayer: "window-minimize",
  toggleShuffle: "random", toggleRepeatOne: "redo", toggleStreamerMode: "broadcast-tower",
};
const labels = {
  fr: {
    play: "Lecture", pause: "Pause", playPause: "Lecture / pause", next: "Piste suivante", previous: "Piste précédente", seek: "Position dans le morceau",
    seekForward: "Avancer de 10 secondes", seekBackward: "Reculer de 10 secondes", volumeSet: "Régler le volume", volumeUp: "Volume +5 %", volumeDown: "Volume −5 %",
    mute: "Couper le son", unmute: "Rétablir le son", toggleMute: "Basculer le son", toggleMiniPlayer: "Basculer le mini-lecteur", showMiniPlayer: "Afficher le mini-lecteur", hideMiniPlayer: "Masquer le mini-lecteur",
    toggleShuffle: "Basculer l’aléatoire", toggleRepeatOne: "Répéter le morceau", toggleStreamerMode: "Mode Streamer ON / OFF", track: "Titre en cours", status: "État de la connexion", dashboard: "Ouvrir le panneau Streamer",
    volume: "Volume (0 à 100 %)", position: "Position en secondes (0 à 86400)", offline: "Hors ligne", disabled: "Extension OFF", noTrack: "Aucun morceau", connected: "Connecté", configure: "Collez la connexion copiée depuis le panneau Streamer dans les réglages de l’extension, puis activez l’extension.", unavailable: "Activez le mode Streamer et vérifiez que MusicDesktop est ouvert. Si le port a changé, recopiez la connexion.", invalid: "Commande ou valeur invalide. Volume : 0 à 100 %. Position : 0 à 86400 secondes.", wake: "Installez MusicDesktop 2.0.3 pour utiliser le bouton Mode Streamer.",
  },
  en: {
    play: "Play", pause: "Pause", playPause: "Play / pause", next: "Next track", previous: "Previous track", seek: "Seek to position",
    seekForward: "Forward 10 seconds", seekBackward: "Back 10 seconds", volumeSet: "Set volume", volumeUp: "Volume +5%", volumeDown: "Volume −5%",
    mute: "Mute", unmute: "Unmute", toggleMute: "Toggle mute", toggleMiniPlayer: "Toggle Mini Player", showMiniPlayer: "Show Mini Player", hideMiniPlayer: "Hide Mini Player",
    toggleShuffle: "Toggle shuffle", toggleRepeatOne: "Repeat track", toggleStreamerMode: "Streamer Mode ON / OFF", track: "Current track", status: "Connection status", dashboard: "Open Streamer dashboard",
    volume: "Volume (0 to 100%)", position: "Position in seconds (0 to 86400)", offline: "Offline", disabled: "Extension OFF", noTrack: "No track", connected: "Connected", configure: "Paste the connection copied from the Streamer dashboard into the extension settings, then enable the extension.", unavailable: "Enable Streamer Mode and check that MusicDesktop is open. If the port changed, copy the connection again.", invalid: "Invalid command or value. Volume: 0 to 100%. Position: 0 to 86400 seconds.", wake: "Install MusicDesktop 2.0.3 to use the Streamer Mode button.",
  },
};

export class MusicDesktopExtension extends Extension {
  constructor(host = {}, dependencies = {}) {
    super();
    this.name = "MusicDesktop";
    this.platforms = [Platforms.windows];
    this.host = host;
    this.dependencies = { WebSocket, fetch: localFetch, ...dependencies };
    this.client = null; this.config = null; this.frame = null; this.initialized = false; this.disposed = false;
    this.lastValues = {}; this.errorVisible = false;
    this._configs = {
      enabled: { type: "text", name: "Extension ON / OFF", descriptions: "ON : connexion active / OFF : déconnecter", value: "OFF" },
      connection: { type: "password", name: "Connexion MusicDesktop / Connection", descriptions: "Panneau Streamer → Copier la connexion / Streamer dashboard → Copy connection", value: "" },
    };
    // Deckboard replaces configs on save. React directly, without polling.
    Object.defineProperty(this, "configs", { enumerable: true, configurable: true,
      get: () => this._configs,
      set: value => {
        for (const name of ["enabled", "connection"]) {
          if (value?.[name] && "value" in value[name]) this._configs[name] = { ...this._configs[name], value: value[name].value };
        }
        if (this.initialized && !this.disposed) this.configure();
      },
    });
    this.language = "fr";
    this.createInputs();
  }
  createInputs() {
    const text = labels[this.language];
    const input = (action, extra = {}) => ({ label: text[action], value: key(action), icon: icons[action] || "music", fontIcon: "fas", color: "#ff3150", ...extra });
    this.inputs = actions.map(action => input(action, {
      ...(dynamic.has(action) ? { mode: "custom-value" } : {}),
      ...(["volumeSet", "seek"].includes(action) ? { input: [{ label: text[action === "volumeSet" ? "volume" : "position"], ref: "value", type: InputTypes.text }] } : {}),
    }));
    this.inputs.push(input("track", { mode: "custom-value" }), input("status", { mode: "custom-value" }), input("dashboard", { icon: "external-link-alt" }));
  }
  async initExtension() {
    if (this.disposed || this.initialized) return;
    this.initialized = true; this.configure();
  }
  update() { if (this.initialized && !this.disposed) this.configure(); }
  enabled() { return typeof this.configs.enabled.value === "string" && this.configs.enabled.value.trim().toUpperCase() === "ON"; }
  configure() {
    let config = null;
    try {
      const raw = this.configs?.connection?.value;
      if (typeof raw === "string" && raw.length <= 2048) config = connection(JSON.parse(raw));
    } catch { /* Never expose credentials in a configuration error. */ }
    const enabled = this.enabled();
    this.language = config?.language || "fr";
    this.createInputs();
    if (this.config?.origin === config?.origin && this.config?.token === config?.token && this.client && enabled) {
      this.config = config; this.publish(); return;
    }
    this.client?.close(); this.client = null; this.frame = null; this.config = config;
    if (enabled && config && !this.disposed) {
      this.client = new ApiClient(config, frame => {
        if (frame.player !== null && typeof frame.player !== "object") throw new Error("Invalid player state");
        this.frame = frame; this.publish();
      }, online => { if (!online) { this.frame = null; this.publish(); } }, this.dependencies);
      this.client.start();
    }
    this.publish();
  }
  publish() {
    const text = labels[this.language];
    const values = {};
    for (const action of dynamic) {
      let title = buttonState(this.frame, action, this.language).title;
      if (action === "toggleStreamerMode" && !this.frame) title = `Streamer\n${text.offline}`;
      if (["toggleShuffle", "toggleRepeatOne", "toggleMiniPlayer"].includes(action) && this.frame) title += `\n${buttonState(this.frame, action, this.language).state ? "ON" : "OFF"}`;
      values[key(action)] = title;
    }
    const player = this.frame?.player;
    values[key("track")] = typeof player?.title === "string" && player.title.trim()
      ? [player.title.slice(0, 180), typeof player.artist === "string" ? player.artist.slice(0, 120) : ""].filter(Boolean).join("\n")
      : text.noTrack;
    values[key("status")] = !this.enabled() ? text.disabled : this.frame ? text.connected : text.offline;
    const changed = Object.fromEntries(Object.entries(values).filter(([name, value]) => this.lastValues[name] !== value));
    if (Object.keys(changed).length) { this.lastValues = values; this.host.setValue?.(changed); }
  }
  execute(type, params) {
    // The host does not await execute(); consume all asynchronous failures.
    void this.run(type, params).catch(error => this.feedback(error.message));
  }
  async run(type, params) {
    const text = labels[this.language];
    if (!this.initialized || this.disposed || !this.config || !this.enabled()) throw new Error(text.configure);
    const action = this.inputs.find(input => input.value === type)?.value.slice("musicdesktop-".length);
    if (action === "track" || action === "status") return;
    if (action === "toggleStreamerMode") {
      try { await this.dependencies.openExternal(`musicdesktop://streamer/toggle?token=${this.config.token}`); }
      catch { throw new Error(text.wake); }
      return;
    }
    if (action === "dashboard") {
      if (!this.frame) throw new Error(text.unavailable);
      try { await this.dependencies.openExternal(`${this.config.origin}/#token=${this.config.token}`); }
      catch { throw new Error(text.unavailable); }
      return;
    }
    if (!actions.includes(action)) throw new Error(text.invalid);
    let value;
    if (action === "volumeSet" || action === "seek") {
      const raw = params?.value;
      if ((typeof raw !== "string" && typeof raw !== "number") || String(raw).trim() === "") throw new Error(text.invalid);
      value = Number(raw);
      if (!Number.isFinite(value) || value < 0 || value > (action === "volumeSet" ? 100 : 86400)) throw new Error(text.invalid);
      if (action === "volumeSet") value /= 100;
    }
    if (!this.client || !this.frame) throw new Error(text.unavailable);
    try { await this.client.command(action, value); }
    catch { throw new Error(text.unavailable); }
  }
  feedback(message) {
    if (this.errorVisible || this.disposed || !this.host.dialog?.showMessageBox) return;
    this.errorVisible = true;
    Promise.resolve().then(() => this.host.dialog.showMessageBox({ type: "warning", title: "MusicDesktop", message, buttons: ["OK"] }))
      .catch(() => {}).finally(() => { this.errorVisible = false; });
  }
  dispose() {
    this.disposed = true; this.client?.close(); this.client = null; this.frame = null;
  }
}
