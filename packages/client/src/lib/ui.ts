// Minimal client-side navigation. The lobby and the account page are the only
// two non-game screens; while you're in a game the table view takes over.
import { writable } from 'svelte/store';

export const page = writable<'lobby' | 'account' | 'howto'>('lobby');
