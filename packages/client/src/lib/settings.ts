// Local, per-browser preferences for game feel. Persisted to localStorage and
// exposed as a Svelte store so components react to changes.
import { writable } from 'svelte/store';

export interface Settings {
  sound: boolean; // play subtle sound effects (card play, etc.)
  dragToPlay: boolean; // drag a card to the middle to play it (vs click)
  clickToPlay: boolean; // also allow a plain tap/click to play (only relevant when dragToPlay is on)
}

const KEY = 'liskat.settings';
const DEFAULTS: Settings = { sound: true, dragToPlay: true, clickToPlay: true };

function load(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...DEFAULTS, ...JSON.parse(raw) };
  } catch {
    // ignore malformed/absent storage
  }
  return { ...DEFAULTS };
}

export const settings = writable<Settings>(load());

settings.subscribe((s) => {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    // storage may be unavailable (private mode); preferences just won't persist
  }
});

export function toggle(key: keyof Settings) {
  settings.update((s) => ({ ...s, [key]: !s[key] }));
}
