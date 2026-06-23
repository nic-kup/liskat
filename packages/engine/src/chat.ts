// Liskat chat is intentionally limited to a small set of canned phrases: no
// free text. This keeps the table friendly and abuse-free. Both the client
// (to render buttons) and the server (to validate) import this list.
export const CHAT_PRESETS = [
  'Hello',
  'Good game',
  'Well played',
  'Surprising!',
  'Oops!',
  'Thanks',
] as const;

export type ChatPreset = (typeof CHAT_PRESETS)[number];

export function isChatPreset(text: string): text is ChatPreset {
  return (CHAT_PRESETS as readonly string[]).includes(text);
}
