// Lightweight accounts: username + password, with an optional email kept only
// for a future password reset. Mirrors lichess's spirit — anonymous play stays
// first-class, no tracking, minimal data. Passwords are hashed with Node's
// built-in scrypt (memory-hard, no external dependency). Users and sessions are
// persisted as JSON files under data/ (gitignored); fine at this scale and
// swappable for a real database later.

import { randomBytes, scrypt as scryptCb, timingSafeEqual, createHash } from 'node:crypto';
import { readFile, writeFile, rename, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCb) as (pw: string, salt: Buffer, len: number) => Promise<Buffer>;

const DATA_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'data');
const USERS_FILE = join(DATA_DIR, 'users.json');
const SESSIONS_FILE = join(DATA_DIR, 'sessions.json');

const SESSION_TTL_MS = 90 * 24 * 60 * 60 * 1000; // 90 days

interface User {
  id: string; // stable account id, also the player identity on the wire ("u_…")
  username: string; // display form
  lname: string; // lowercased, for case-insensitive uniqueness/lookup
  hash: string; // "scrypt$<saltHex>$<hashHex>"
  email?: string;
  createdAt: string;
}

interface Session {
  thash: string; // sha256(token) — we never store the raw token
  userId: string;
  createdAt: number;
}

export interface AuthResult {
  ok: boolean;
  token?: string;
  username?: string;
  error?: string;
}

const usersById = new Map<string, User>();
const usersByName = new Map<string, User>(); // lname -> user
const sessions = new Map<string, Session>(); // thash -> session

// ---- persistence -----------------------------------------------------------

async function atomicWrite(file: string, data: string): Promise<void> {
  await mkdir(DATA_DIR, { recursive: true });
  const tmp = `${file}.tmp`;
  await writeFile(tmp, data, 'utf8');
  await rename(tmp, file);
}

async function saveUsers(): Promise<void> {
  await atomicWrite(USERS_FILE, JSON.stringify([...usersById.values()]));
}
async function saveSessions(): Promise<void> {
  await atomicWrite(SESSIONS_FILE, JSON.stringify([...sessions.values()]));
}

export async function initAccounts(): Promise<void> {
  try {
    const raw = JSON.parse(await readFile(USERS_FILE, 'utf8')) as User[];
    for (const u of raw) {
      usersById.set(u.id, u);
      usersByName.set(u.lname, u);
    }
  } catch {
    /* no users file yet */
  }
  try {
    const raw = JSON.parse(await readFile(SESSIONS_FILE, 'utf8')) as Session[];
    const now = Date.now();
    for (const s of raw) if (now - s.createdAt <= SESSION_TTL_MS) sessions.set(s.thash, s);
  } catch {
    /* no sessions file yet */
  }
}

// ---- hashing / tokens ------------------------------------------------------

async function hashPassword(pw: string): Promise<string> {
  const salt = randomBytes(16);
  const dk = await scrypt(pw, salt, 32);
  return `scrypt$${salt.toString('hex')}$${dk.toString('hex')}`;
}

async function verifyPassword(pw: string, stored: string): Promise<boolean> {
  const [scheme, saltHex, hashHex] = stored.split('$');
  if (scheme !== 'scrypt' || !saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, 'hex');
  const dk = await scrypt(pw, Buffer.from(saltHex, 'hex'), expected.length);
  return dk.length === expected.length && timingSafeEqual(dk, expected);
}

const thash = (token: string): string => createHash('sha256').update(token).digest('hex');

async function createSession(userId: string): Promise<string> {
  const token = randomBytes(32).toString('hex');
  const h = thash(token);
  sessions.set(h, { thash: h, userId, createdAt: Date.now() });
  await saveSessions();
  return token;
}

// ---- public API ------------------------------------------------------------

export async function register(username: string, password: string, email?: string): Promise<AuthResult> {
  const uname = username.trim();
  if (!/^[A-Za-z0-9_-]{3,20}$/.test(uname)) return { ok: false, error: 'Username must be 3–20 letters, digits, _ or -.' };
  if (password.length < 6 || password.length > 200) return { ok: false, error: 'Password must be 6–200 characters.' };
  const lname = uname.toLowerCase();
  if (usersByName.has(lname)) return { ok: false, error: 'That username is taken.' };
  const mail = (email ?? '').trim();
  if (mail.length > 200) return { ok: false, error: 'Email is too long.' };

  const user: User = {
    id: `u_${randomBytes(8).toString('hex')}`,
    username: uname,
    lname,
    hash: await hashPassword(password),
    email: mail || undefined,
    createdAt: new Date().toISOString(),
  };
  usersById.set(user.id, user);
  usersByName.set(lname, user);
  await saveUsers();
  const token = await createSession(user.id);
  return { ok: true, token, username: user.username };
}

export async function login(username: string, password: string): Promise<AuthResult> {
  const user = usersByName.get(username.trim().toLowerCase());
  if (!user) {
    // Burn comparable time so a missing user isn't distinguishable by timing.
    await hashPassword(password);
    return { ok: false, error: 'Wrong username or password.' };
  }
  if (!(await verifyPassword(password, user.hash))) return { ok: false, error: 'Wrong username or password.' };
  const token = await createSession(user.id);
  return { ok: true, token, username: user.username };
}

export async function logout(token: string): Promise<void> {
  if (token && sessions.delete(thash(token))) await saveSessions();
}

// Resolves a session token to its account id, pruning if expired.
export function userIdForToken(token: string | null | undefined): string | null {
  if (!token) return null;
  const s = sessions.get(thash(token));
  if (!s) return null;
  if (Date.now() - s.createdAt > SESSION_TTL_MS) {
    sessions.delete(s.thash);
    void saveSessions();
    return null;
  }
  return s.userId;
}

export function usernameForId(id: string): string | null {
  return usersById.get(id)?.username ?? null;
}
