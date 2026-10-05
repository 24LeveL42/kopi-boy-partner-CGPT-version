// A short two-tone chime made with WebAudio (no audio asset to ship). Browsers
// only allow audio after a user gesture, so `unlockAudio` is wired to the
// first tap/keypress (see NotificationsProvider) — until then chimes are
// skipped silently and the toast + vibration still fire.

let ctx: AudioContext | null = null;

export function unlockAudio() {
  try {
    ctx ??= new AudioContext();
    if (ctx.state === "suspended") void ctx.resume();
  } catch {
    // no WebAudio — sound is just unavailable
  }
}

export function playChime() {
  try {
    if (!ctx || ctx.state !== "running") return;
    const start = ctx.currentTime;
    [
      { freq: 880, at: 0 },
      { freq: 1175, at: 0.16 },
    ].forEach(({ freq, at }) => {
      const osc = ctx!.createOscillator();
      const gain = ctx!.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, start + at);
      gain.gain.exponentialRampToValueAtTime(0.25, start + at + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + at + 0.28);
      osc.connect(gain).connect(ctx!.destination);
      osc.start(start + at);
      osc.stop(start + at + 0.3);
    });
  } catch {
    // ignore
  }
}
