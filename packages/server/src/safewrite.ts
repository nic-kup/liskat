// Crash- and race-safe JSON file writes. Two protections layered together:
//
//  1. A unique temp name per write (so two concurrent writers never share one
//     tmp path and interleave their bytes into it) followed by an atomic rename
//     (so a reader never sees a half-written file).
//  2. A per-file promise chain so writes to the same logical file are applied
//     one at a time. Without this, two unawaited writes to e.g. ratings.json can
//     both rename their tmp over the target and the later-finishing write wins
//     nondeterministically; worse, a failed interleave can leave corrupt JSON
//     that resets the whole store to empty on next boot.
//
// In a single-process server the in-memory state is already race-free; this only
// serializes the disk side.

import { mkdir, writeFile, rename } from 'node:fs/promises';
import { dirname } from 'node:path';
import { randomBytes } from 'node:crypto';

const chains = new Map<string, Promise<void>>();

async function doWrite(file: string, data: string): Promise<void> {
  await mkdir(dirname(file), { recursive: true });
  const tmp = `${file}.${randomBytes(6).toString('hex')}.tmp`;
  await writeFile(tmp, data, 'utf8');
  await rename(tmp, file);
}

// Queues a write to `file`, guaranteeing writes to the same path run serially.
// Returns a promise that resolves when this particular write has landed.
//
// The chains map self-cleans: each entry deletes itself once it settles unless a
// newer write has already claimed the tail. This matters because some callers
// (match-replay details) write a *unique* path per match; without cleanup the
// map would gain one dead entry per match recorded, forever.
export function safeWrite(file: string, data: string): Promise<void> {
  const prev = chains.get(file) ?? Promise.resolve();
  // Swallow a prior failure so one bad write doesn't poison the whole chain,
  // but still surface this write's own result to the caller.
  const next = prev.catch(() => {}).then(() => doWrite(file, data));
  const guarded = next.catch(() => {});
  chains.set(file, guarded);
  // Drop the entry when it settles, but only if it's still the latest write for
  // this path (a later safeWrite chained onto `guarded` and must stay the tail).
  void guarded.then(() => {
    if (chains.get(file) === guarded) chains.delete(file);
  });
  return next;
}
