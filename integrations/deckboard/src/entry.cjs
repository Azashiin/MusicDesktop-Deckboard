const { app, shell } = require("electron");
const { MusicDesktopExtension } = require("./extension.js");
let previous;
module.exports = host => {
  if (previous) { app.removeListener("before-quit", previous.quit); previous.extension.dispose(); }
  const extension = new MusicDesktopExtension(host, { openExternal: url => shell.openExternal(url) });
  const quit = () => extension.dispose();
  app.once("before-quit", quit);
  previous = { extension, quit };
  return extension;
};
