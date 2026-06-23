// Tiny synthesized sound effects via the Web Audio API, so we ship no binary
// assets. The card sound is a short filtered-noise "snap" plus a soft low thump:
// the sound of a card being laid on the table. Kept deliberately subtle.
import { get } from 'svelte/store';
import { settings } from './settings.ts';

let ctx: AudioContext | null = null;

function audio(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  if (!ctx) {
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
  }
  // Browsers start the context suspended until a user gesture; resume on demand.
  if (ctx.state === 'suspended') void ctx.resume();
  return ctx;
}

export function playCardSound() {
  if (!get(settings).sound) return;
  const c = audio();
  if (!c) return;
  const t = c.currentTime;

  // A very short, dark noise tick: the soft brush of the card on felt. Low-passed
  // (no bright 2kHz snap) and quiet, so it reads as a touch rather than a click.
  const dur = 0.035;
  const buf = c.createBuffer(1, Math.max(1, Math.ceil(c.sampleRate * dur)), c.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < data.length; i++) {
    const env = 1 - i / data.length;
    data[i] = (Math.random() * 2 - 1) * env * env;
  }
  const noise = c.createBufferSource();
  noise.buffer = buf;
  const lp = c.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 700;
  const ng = c.createGain();
  ng.gain.value = 0.05;
  noise.connect(lp).connect(ng).connect(c.destination);
  noise.start(t);

  // Low, short body with a gentle upward sweep ("tup") instead of a heavy thud.
  const osc = c.createOscillator();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(120, t);
  osc.frequency.exponentialRampToValueAtTime(190, t + 0.05);
  const og = c.createGain();
  og.gain.setValueAtTime(0.0001, t);
  og.gain.exponentialRampToValueAtTime(0.04, t + 0.004);
  og.gain.exponentialRampToValueAtTime(0.0001, t + 0.07);
  osc.connect(og).connect(c.destination);
  osc.start(t);
  osc.stop(t + 0.08);
}
