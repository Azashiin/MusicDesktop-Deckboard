export function buttonState(frame, command, language = "fr") {
  const en = language === "en"; const player = frame?.player;
  if (command === "toggleStreamerMode") return { title: `Streamer\n${frame?.enabled ? "ON" : "OFF"}`, state: Number(Boolean(frame?.enabled)) };
  if (!frame) return { title: en ? "Offline" : "Hors ligne", state: 0 };
  const active = command === "playPause" ? player?.playback_state === "PLAYING" : command === "toggleMute" ? player?.muted : command === "toggleShuffle" ? player?.shuffle_enabled : command === "toggleRepeatOne" ? player?.repeat_mode === "ONE" : command === "toggleMiniPlayer" ? frame.mini_player_visible : false;
  const labels = {
    playPause: active ? "Pause" : en ? "Play" : "Lecture", toggleMute: active ? en ? "Unmute" : "Son ON" : en ? "Mute" : "Son OFF",
    play: en ? "Play" : "Lecture", pause: "Pause", next: en ? "Next" : "Suivant", previous: en ? "Previous" : "Précédent", seek: "Seek", seekForward: "+10 s", seekBackward: "−10 s",
    volumeSet: "Volume", volumeUp: "Volume +", volumeDown: "Volume −", mute: en ? "Mute" : "Son OFF", unmute: en ? "Unmute" : "Son ON",
    toggleShuffle: en ? "Shuffle" : "Aléatoire", toggleRepeatOne: en ? "Repeat" : "Répéter", toggleMiniPlayer: "Mini", showMiniPlayer: "Mini ON", hideMiniPlayer: "Mini OFF",
  };
  return { title: labels[command] || "MusicDesktop", state: Number(Boolean(active)) };
}
