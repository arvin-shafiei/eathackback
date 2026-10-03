// Shared runtime bus between the crowd (physics) and the rest of the scene + a tiny sfx kit (WebAudio beeps, spoken minion-speak).
// Everything here is presentation only: physics bonks, shakes and sounds never touch the run log or a stat.

export const bus = {
  /** live xz of the followed shopper (physics position, not the replay path) */
  follow: null as null | { x: number; z: number; heading: number },
  /** shoppers near each sliding door (index = entrance, then exits after them) */
  doors: [] as number[],
  /** last scanner beep per lane id (clock seconds) → scanner flash */
  flash: {} as Record<string, number>,
  /** EAS gate alarm: gate id → clock seconds until which it flashes + beeps */
  alarm: {} as Record<string, number>,
  /** ops clock (minute of day) and the ops log's stock share per slot at that minute */
  opsMin: 0,
  stock: null as Record<string, number> | null,
  /** screen-shake energy, decays in the camera rig */
  shake: 0,
  shakeOn: false,
  /** total bonks this session (visual only) */
  bonks: 0,
  listeners: new Set<() => void>(),
  emit() { this.listeners.forEach((f) => f()); },
};

/** minion-speak for the three shopper sounds: said by the browser's own speech voice, pitched right up.
 *  no audio files. presentation only, like every sound here */
const CHATTER = {
  pick: ['baboi!', 'banana!', 'bello!', 'tank yu!'],
  nope: ['no no no', 'poka?', 'bah'],
  bonk: ['whaaa', 'ow ow', 'hee hee'],
  alarm: ['bee do, bee do, bee do'],
};
/** assumption: at most one spoken word every 650 ms, so a busy aisle chirps instead of talking over itself */
const SAY_GAP_MS = 650;
let lastSay = 0;
/** speak one of `words`; returns false when the browser cannot or it is too soon, so the caller plays its beep instead */
function say(words: string[]): boolean {
  const synth = typeof window !== 'undefined' ? window.speechSynthesis : undefined;
  if (!synth || typeof SpeechSynthesisUtterance === 'undefined') return false;
  // no installed voice (some browsers, or before the voice list has loaded): nothing would be heard, so beep instead
  if (!synth.getVoices().length) return false;
  const now = performance.now();
  if (now - lastSay < SAY_GAP_MS || synth.speaking) return false;
  lastSay = now;
  const u = new SpeechSynthesisUtterance(words[Math.floor(Math.random() * words.length)]);
  u.pitch = 2; u.rate = 1.35; u.volume = 0.7;
  synth.speak(u);
  return true;
}

let ctx: AudioContext | null = null;
export const sfx = {
  on: false,
  ensure() {
    if (!this.on) return null;
    try {
      ctx ??= new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
      if (ctx.state === 'suspended') void ctx.resume();
      return ctx;
    } catch { return null; }
  },
  blip(f0: number, f1: number, dur: number, type: OscillatorType = 'sine', gain = 0.12) {
    const c = this.ensure(); if (!c) return;
    const o = c.createOscillator(), g = c.createGain();
    o.type = type; o.frequency.setValueAtTime(f0, c.currentTime); o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), c.currentTime + dur);
    g.gain.setValueAtTime(gain, c.currentTime); g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + dur);
    o.connect(g).connect(c.destination); o.start(); o.stop(c.currentTime + dur + 0.02);
  },
  bonk() { if (!this.on) return; if (!say(CHATTER.bonk)) this.blip(520, 90, 0.18, 'triangle', 0.16); },
  pick() { if (!this.on) return; if (!say(CHATTER.pick)) this.blip(660, 1320, 0.12, 'sine', 0.08); },
  nope() { if (!this.on) return; if (!say(CHATTER.nope)) this.blip(300, 160, 0.22, 'square', 0.04); },
  beep() { this.blip(1850, 1840, 0.09, 'square', 0.035); },
  alarm() { if (!this.on) return; say(CHATTER.alarm); [0, 0.22, 0.44].forEach((d) => setTimeout(() => this.blip(2200, 2150, 0.16, 'square', 0.05), d * 1000)); },
  ding() { this.blip(880, 1760, 0.25, 'sine', 0.07); },
};
