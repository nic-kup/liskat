// Minimal client-side navigation. The lobby and the account page are the only
// other non-game screens; while you're in a game the table view takes over.
//
// "How to play" has its own URL (/how-to-play) so it can be shared as an
// explainer link; the server's SPA fallback serves index.html for it. Every
// other screen lives at the app root, preserving any ?table= invite query.
// The `page` store keeps the URL in sync on every change and reflects the
// browser back/forward button, so all the plain `$page = '…'` call sites stay
// URL-aware for free.
import { writable } from 'svelte/store';

export type Page = 'lobby' | 'account' | 'howto' | 'leaderboard';

const HOWTO_PATH = '/how-to-play';

function pageFromPath(): Page {
  return typeof location !== 'undefined' && location.pathname === HOWTO_PATH ? 'howto' : 'lobby';
}

// The URL a page should live at: howto has its own path; everything else sits
// at the root and keeps the current query (so a ?table= invite survives a
// detour through the lobby/account screens).
function urlFor(p: Page): string {
  return p === 'howto' ? HOWTO_PATH : '/' + location.search;
}

const DEFAULT_TITLE = 'liskat | Free Online Skat';

function applyTitle(p: Page): void {
  if (typeof document === 'undefined') return;
  document.title = p === 'howto' ? 'How to play Skat | liskat' : DEFAULT_TITLE;
}

function pushUrl(p: Page): void {
  if (typeof history === 'undefined') return;
  const url = urlFor(p);
  if (location.pathname + location.search !== url) history.pushState({ page: p }, '', url);
}

const inner = writable<Page>(pageFromPath());
applyTitle(pageFromPath()); // correct the tab title on a direct /how-to-play load

function go(p: Page): Page {
  pushUrl(p);
  applyTitle(p);
  return p;
}

export const page = {
  subscribe: inner.subscribe,
  set(p: Page): void {
    inner.set(go(p));
  },
  update(fn: (cur: Page) => Page): void {
    inner.update((cur) => go(fn(cur)));
  },
};

// Back/forward: mirror the URL into the store WITHOUT pushing a new entry.
if (typeof window !== 'undefined') {
  window.addEventListener('popstate', () => {
    const p = pageFromPath();
    applyTitle(p);
    inner.set(p);
  });
}
