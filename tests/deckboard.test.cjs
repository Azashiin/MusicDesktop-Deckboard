const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const http = require("node:http");
const { EventEmitter } = require("node:events");
const { createRequire } = require("node:module");
const { WebSocketServer } = require("../integrations/deckboard/node_modules/ws");
const packageRoot = path.resolve(__dirname, "../integrations/deckboard/dist/package");
const waitFor = async condition => {
  const deadline = Date.now() + 5000;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error("Timed out waiting for Deckboard extension");
    await new Promise(resolve => setTimeout(resolve, 20));
  }
};
function load() {
  const values = {}, updates = [], dialogs = [], opened = [], output = [];
  const app = new EventEmitter(); app.getName = () => "Deckboard test";
  const electron = { app, shell: { openExternal: async url => { opened.push(url); } } };
  const module = { exports: {} }, requirePackage = createRequire(path.join(packageRoot, "index.js"));
  const context = vm.createContext({ module, exports: module.exports,
    require: name => name === "electron" ? electron : requirePackage(name),
    __filename: path.join(packageRoot, "index.js"), __dirname: packageRoot,
    process, Buffer, URL, AbortController, setTimeout, clearTimeout, setInterval, clearInterval,
    console: { log: value => output.push(value), error: value => output.push(value), warn: value => output.push(value) },
  });
  new vm.Script(fs.readFileSync(path.join(packageRoot, "index.js"), "utf8")).runInContext(context);
  assert.equal(typeof module.exports, "function", "Deckboard requires a factory export");
  const host = { setValue: data => { updates.push(data); Object.assign(values, data); },
    dialog: { showMessageBox: async data => { dialogs.push(data); } } };
  const extension = module.exports(host);
  return { extension, factory: module.exports, host, app, values, updates, dialogs, opened, output };
}
const configure = (extension, origin, token, language = "en") => {
  // Exactly the shape emitted by Deckboard 3.2.0's settings editor.
  extension.configs = { enabled: { type: "text", value: "ON" },
    connection: { type: "password", value: JSON.stringify({ origin, token, language }) } };
};
async function fixture(t) {
  const requests = [], sockets = new Set(); let connections = 0, status = 200;
  const frame = { v: 1, enabled: true, connected: true, mini_player_visible: true,
    player: { playback_state: "PLAYING", title: "First track", artist: "Artist", muted: false, shuffle_enabled: false, repeat_mode: "OFF" } };
  const server = http.createServer((request, response) => {
    let body = "";
    request.on("data", chunk => body += chunk);
    request.on("end", () => {
      requests.push({ url: request.url, auth: request.headers.authorization, body: JSON.parse(body) });
      response.writeHead(status, { "content-type": "application/json", ...(status === 302 ? { location: "http://192.0.2.1/private" } : {}) });
      response.end('{"ok":true}');
    });
  });
  const ws = new WebSocketServer({ server });
  ws.on("connection", (socket, request) => {
    assert.equal(new URL(request.url, "http://127.0.0.1").searchParams.get("token"), "c".repeat(64));
    connections++; sockets.add(socket); socket.on("close", () => sockets.delete(socket)); socket.send(JSON.stringify(frame));
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(async () => { for (const socket of sockets) socket.terminate(); await new Promise(resolve => ws.close(resolve)); await new Promise(resolve => server.close(resolve)); });
  return { origin: `http://127.0.0.1:${server.address().port}`, token: "c".repeat(64), requests, sockets, frame,
    get connections() { return connections; }, set status(value) { status = value; },
    send: value => { for (const socket of sockets) socket.send(JSON.stringify(value)); } };
}

test("Deckboard archive exposes a Windows SDK factory with usable global settings", async () => {
  const { extractFile, listPackage } = await import("../integrations/deckboard/node_modules/@electron/asar/lib/asar.js");
  const archive = path.resolve(__dirname, "../frontend/public/integrations/musicdesktop-deckboard.asar");
  const files = listPackage(archive).map(file => file.replaceAll("\\", "/"));
  assert.deepEqual(files.sort(), ["/LICENSE", "/THIRD_PARTY_NOTICES.txt", "/extension.yml", "/index.js", "/package.json"].sort());
  const manifest = JSON.parse(extractFile(archive, "package.json"));
  assert.equal(manifest.main, "index.js"); assert.equal(manifest.version, "2.0.3");
  assert.match(extractFile(archive, "extension.yml").toString(), /package: musicdesktop-deckboard/);
  const h = load(), e = h.extension;
  assert.equal(e.name, "MusicDesktop"); assert.equal(e.platforms[0], "WINDOWS");
  assert.equal(e.selections[0].header, "MusicDesktop"); assert.equal(e.inputs.length, 23);
  assert.equal(e.configs.connection.type, "password"); assert.equal(e.configs.enabled.type, "text");
  await e.initExtension(); await e.initExtension(); e.update();
  assert.equal(e.client, null); assert.equal(h.values["musicdesktop-status"], "Extension OFF");
  assert.equal(h.updates.length, 1, "No redundant values or polling when unused");
  configure(e, "http://192.168.1.2:24673", "c".repeat(64));
  assert.equal(e.client, null); assert.equal(e.config, null);
  assert.ok(e.configs.connection.name, "Saving host values preserves field descriptions");
  e.execute("musicdesktop-playPause", {});
  await waitFor(() => h.dialogs.length === 1);
  assert.equal(JSON.stringify(h.dialogs).includes("c".repeat(64)), false);
  e.dispose(); h.app.emit("before-quit");
});

test("packaged Deckboard actions share one live socket and validate volume/seek HTTP", { timeout: 15000 }, async t => {
  const f = await fixture(t), h = load(), e = h.extension;
  t.after(() => e.dispose());
  configure(e, f.origin, f.token);
  assert.equal(e.client, null, "Saved settings are applied when host initializes");
  await e.initExtension();
  await waitFor(() => h.values["musicdesktop-playPause"] === "Pause");
  for (let i = 0; i < 4; i++) e.update();
  assert.equal(f.connections, 1); assert.equal(h.values["musicdesktop-track"], "First track\nArtist");
  assert.equal(h.values["musicdesktop-toggleMiniPlayer"], "Mini\nON");
  const previousUpdates = h.updates.length; f.send(f.frame);
  await new Promise(resolve => setTimeout(resolve, 40)); assert.equal(h.updates.length, previousUpdates);
  await e.run("musicdesktop-playPause", {});
  await e.run("musicdesktop-volumeSet", { value: "35" });
  await e.run("musicdesktop-seek", { value: "42" });
  await e.run("musicdesktop-volumeUp", {}); await e.run("musicdesktop-seekBackward", {});
  assert.deepEqual(f.requests.map(request => request.body), [{ action: "playPause" }, { action: "volumeSet", value: 0.35 }, { action: "seek", value: 42 }, { action: "volumeUp" }, { action: "seekBackward" }]);
  assert.ok(f.requests.every(request => request.url === "/api/commands" && request.auth === `Bearer ${f.token}`));
  for (const value of ["", " ", "abc", "101", "-1", "Infinity", {}, null]) await assert.rejects(e.run("musicdesktop-volumeSet", { value }));
  for (const value of ["-1", "86401", "NaN"]) await assert.rejects(e.run("musicdesktop-seek", { value }));
  await assert.rejects(e.run("musicdesktop-shell", { value: "calc.exe" }));
  assert.equal(f.requests.length, 5, "Invalid actions never reach the server");
  f.send({ ...f.frame, mini_player_visible: false, player: { ...f.frame.player, title: "Second track", playback_state: "PAUSED", muted: true, shuffle_enabled: true, repeat_mode: "ONE" } });
  await waitFor(() => h.values["musicdesktop-playPause"] === "Play");
  assert.equal(h.values["musicdesktop-toggleMute"], "Unmute"); assert.equal(h.values["musicdesktop-toggleShuffle"], "Shuffle\nON");
  assert.equal(h.values["musicdesktop-toggleRepeatOne"], "Repeat\nON"); assert.equal(h.values["musicdesktop-track"], "Second track\nArtist");
  f.status = 302; e.execute("musicdesktop-next", {});
  await waitFor(() => h.dialogs.length === 1); assert.equal(f.requests.length, 6, "HTTP redirect is not followed");
  assert.equal(JSON.stringify(h.dialogs).includes(f.token), false); assert.equal(JSON.stringify(h.output).includes(f.token), false);
});

test("Deckboard reconnects, opens fixed authenticated app links and releases clients on OFF/reload/quit", { timeout: 15000 }, async t => {
  const f = await fixture(t), h = load(); let e = h.extension;
  t.after(() => e.dispose());
  configure(e, f.origin, f.token); await e.initExtension(); await waitFor(() => e.frame);
  await e.run("musicdesktop-dashboard", {});
  assert.equal(h.opened[0], `${f.origin}/#token=${f.token}`);
  for (const socket of f.sockets) socket.close();
  await waitFor(() => !e.frame);
  assert.equal(h.values["musicdesktop-toggleStreamerMode"], "Streamer\nOffline");
  await e.run("musicdesktop-toggleStreamerMode", { url: "https://evil.invalid" });
  assert.equal(h.opened[1], `musicdesktop://streamer/toggle?token=${f.token}`);
  await waitFor(() => f.connections === 2 && e.frame);
  configure(e, f.origin, f.token, "fr"); assert.equal(f.connections, 2);
  assert.equal(e.inputs.find(input => input.value === "musicdesktop-playPause").label, "Lecture / pause");
  e.configs = { enabled: { type: "text", value: "OFF" } };
  await waitFor(() => f.sockets.size === 0); assert.equal(e.client, null);
  await new Promise(resolve => setTimeout(resolve, 650)); assert.equal(f.connections, 2, "OFF cancels reconnect timers");
  configure(e, f.origin, f.token); await waitFor(() => f.connections === 3);
  const old = e; e = h.factory(h.host);
  assert.equal(old.disposed, true); assert.equal(h.app.listenerCount("before-quit"), 1);
  await waitFor(() => f.sockets.size === 0);
  configure(e, f.origin, f.token); await e.initExtension(); await waitFor(() => e.frame);
  h.app.emit("before-quit"); await waitFor(() => f.sockets.size === 0); assert.equal(e.disposed, true);
});
