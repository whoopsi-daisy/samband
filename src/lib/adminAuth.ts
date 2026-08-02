import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { getDatabase, getDataDir } from './db';

// Credentials for /stats and the import API.
//
// There are two ways to have them, and they are not equivalent:
//
//   STATS_USER / STATS_PASSWORD   an operator decision, fixed at deploy time
//   the admin_user table          chosen in the browser on first start
//
// The environment pair came first and still wins when it is set, because an
// existing deployment that upgrades into this file must keep logging in with
// the password it already has. Everything else is the first-run path: an empty
// database with no environment credentials sends the first visitor to
// /stats/setup, where they pick a name and a password that is stored as a
// scrypt hash rather than sitting in plaintext in a dashboard, a compose file
// and somebody's shell history.
//
// Whoever reaches /stats/setup first owns the dashboard, so on a public URL
// that page cannot simply be open. Setup asks for a one-time token, printed to
// the container log at startup and written next to the database. That is one
// copy-paste for the operator, and a wall for anyone who merely found the URL.
// ADMIN_SETUP_OPEN=true drops the token for deployments that are not reachable
// from the internet during setup.

const SETUP_TOKEN_FILE = 'admin-setup-token.txt';
const SETUP_TOKEN_KEY = 'admin_setup_token';

// scrypt parameters. N=16384 costs ~16MB and ~60ms per verification here,
// which is nothing on a login page and a great deal for anyone working through
// a password list. Stored alongside the hash so these can be raised later
// without invalidating existing rows.
const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const KEY_LENGTH = 32;
const SALT_LENGTH = 16;

// Basic auth sends "user:password", and the proxy splits at the first colon.
// A colon in the password is fine; one in the username would make the account
// impossible to log in to, so it is rejected at the point it is chosen.
const MAX_USERNAME_LENGTH = 64;
const MIN_PASSWORD_LENGTH = 12;
// scrypt runs over whatever it is given, so cap the input rather than let a
// request body decide how long the server spends hashing.
const MAX_PASSWORD_LENGTH = 512;

export interface AdminAccount {
  username: string;
  createdAt: string;
}

/** Which of the two credential sources is in force. */
export type AdminAuthMode =
  | 'env' // STATS_USER/STATS_PASSWORD
  | 'stored' // an account created through /stats/setup
  | 'public' // STATS_PUBLIC=true, deliberately no login
  | 'setup'; // nothing configured yet

export function getEnvCredentials(): { username: string; password: string } | null {
  const username = process.env.STATS_USER;
  const password = process.env.STATS_PASSWORD;
  if (!username || !password) return null;
  return { username, password };
}

export function getStoredAdmin(): AdminAccount | null {
  const row = getDatabase()
    .prepare('SELECT username, created_at FROM admin_user WHERE id = 1')
    .get() as { username: string; created_at: string } | undefined;
  return row ? { username: row.username, createdAt: row.created_at } : null;
}

export function hasStoredAdmin(): boolean {
  return getStoredAdmin() !== null;
}

/**
 * Resolve the mode without throwing.
 *
 * The database lookup can fail (an unwritable mount, a corrupt file), and this
 * runs in the proxy where a throw becomes a 500 on a page whose whole job is to
 * tell an operator what is wrong. A read that fails is reported as such and the
 * caller closes the route; it never falls through to 'public'.
 */
export function resolveAuthMode(): { mode: AdminAuthMode } | { error: string } {
  if (getEnvCredentials()) return { mode: 'env' };

  try {
    if (hasStoredAdmin()) return { mode: 'stored' };
  } catch (cause) {
    return { error: cause instanceof Error ? cause.message : String(cause) };
  }

  if (process.env.STATS_PUBLIC === 'true') return { mode: 'public' };
  return { mode: 'setup' };
}

export function isSetupOpen(): boolean {
  return process.env.ADMIN_SETUP_OPEN === 'true';
}

// ── Hashing ─────────────────────────────────────────────────────────────────

function encodeHash(salt: Buffer, key: Buffer): string {
  return [
    'scrypt',
    SCRYPT_N,
    SCRYPT_R,
    SCRYPT_P,
    salt.toString('base64'),
    key.toString('base64'),
  ].join('$');
}

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(SALT_LENGTH);
  const key = crypto.scryptSync(password.normalize('NFC'), salt, KEY_LENGTH, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
  });
  return encodeHash(salt, key);
}

export function verifyPassword(password: string, encoded: string): boolean {
  const parts = encoded.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;

  const N = parseInt(parts[1], 10);
  const r = parseInt(parts[2], 10);
  const p = parseInt(parts[3], 10);
  if (!N || !r || !p) return false;

  const salt = Buffer.from(parts[4], 'base64');
  const expected = Buffer.from(parts[5], 'base64');
  if (salt.length === 0 || expected.length === 0) return false;

  let actual: Buffer;
  try {
    actual = crypto.scryptSync(password.normalize('NFC'), salt, expected.length, {
      N,
      r,
      p,
      // A row written with heavier parameters than the current default must
      // still verify, and scrypt's default maxmem would refuse it.
      maxmem: 256 * 1024 * 1024,
    });
  } catch {
    return false;
  }

  return crypto.timingSafeEqual(actual, expected);
}

/**
 * Compare two strings without letting the time taken reveal how far they
 * matched. timingSafeEqual needs equal lengths, so hash both sides first: the
 * digests are always 32 bytes whatever the inputs were.
 */
export function safeEqual(a: string, b: string): boolean {
  const left = crypto.createHash('sha256').update(a, 'utf8').digest();
  const right = crypto.createHash('sha256').update(b, 'utf8').digest();
  return crypto.timingSafeEqual(left, right);
}

// ── Verification ────────────────────────────────────────────────────────────

/**
 * Check a username/password pair against whichever source is in force.
 *
 * Both halves are always evaluated, so a wrong username and a wrong password
 * cost the same and neither can be probed independently.
 */
export function verifyCredentials(username: string, password: string): boolean {
  const env = getEnvCredentials();
  if (env) {
    const userOk = safeEqual(username, env.username);
    const passwordOk = safeEqual(password, env.password);
    return userOk && passwordOk;
  }

  const row = getDatabase()
    .prepare('SELECT username, password_hash FROM admin_user WHERE id = 1')
    .get() as { username: string; password_hash: string } | undefined;
  if (!row) return false;

  const userOk = safeEqual(username, row.username);
  const passwordOk = verifyPassword(password, row.password_hash);
  return userOk && passwordOk;
}

// ── Creating the account ────────────────────────────────────────────────────

export class AdminSetupError extends Error {}

export function validateUsername(username: string): string {
  const trimmed = username.trim();
  if (trimmed.length < 3) {
    throw new AdminSetupError('Användarnamnet måste vara minst 3 tecken.');
  }
  if (trimmed.length > MAX_USERNAME_LENGTH) {
    throw new AdminSetupError(`Användarnamnet får vara högst ${MAX_USERNAME_LENGTH} tecken.`);
  }
  if (trimmed.includes(':')) {
    throw new AdminSetupError('Användarnamnet får inte innehålla kolon.');
  }
  if (/[\x00-\x1f\x7f]/.test(trimmed)) {
    throw new AdminSetupError('Användarnamnet får inte innehålla styrtecken.');
  }
  return trimmed;
}

export function validatePassword(password: string, username: string): string {
  if (password.length < MIN_PASSWORD_LENGTH) {
    throw new AdminSetupError(`Lösenordet måste vara minst ${MIN_PASSWORD_LENGTH} tecken.`);
  }
  if (password.length > MAX_PASSWORD_LENGTH) {
    throw new AdminSetupError(`Lösenordet får vara högst ${MAX_PASSWORD_LENGTH} tecken.`);
  }
  if (password.trim().toLowerCase() === username.trim().toLowerCase()) {
    throw new AdminSetupError('Lösenordet får inte vara samma som användarnamnet.');
  }
  return password;
}

/**
 * Write the single admin row.
 *
 * Refuses if one already exists: this is the first-run path, not a password
 * reset, and the endpoint in front of it is reachable without a login. Undoing
 * it is a deliberate act on the host (see clearStoredAdmin).
 */
export function createStoredAdmin(username: string, password: string): AdminAccount {
  const name = validateUsername(username);
  validatePassword(password, name);

  const database = getDatabase();
  if (hasStoredAdmin()) {
    throw new AdminSetupError('Ett administratörskonto finns redan.');
  }

  const createdAt = new Date().toISOString();
  database
    .prepare(
      'INSERT INTO admin_user (id, username, password_hash, created_at) VALUES (1, ?, ?, ?)'
    )
    .run(name, hashPassword(password), createdAt);

  consumeSetupToken();
  console.log(`[auth] admin account "${name}" created; /stats now requires a login`);
  return { username: name, createdAt };
}

/** Used by `npm run admin:reset` to hand the machine back to its owner. */
export function clearStoredAdmin(): void {
  getDatabase().prepare('DELETE FROM admin_user WHERE id = 1').run();
  getDatabase().prepare('DELETE FROM meta WHERE key = ?').run(SETUP_TOKEN_KEY);
  try {
    fs.rmSync(path.join(getDataDir(), SETUP_TOKEN_FILE), { force: true });
  } catch {
    // The token file is a convenience copy; the row above is the truth.
  }
}

// ── The setup token ─────────────────────────────────────────────────────────

function tokenFilePath(): string {
  return path.join(getDataDir(), SETUP_TOKEN_FILE);
}

/**
 * The startup line an operator has to notice among the import chatter, so it
 * gets a box. Drawn from one width rather than by counting spaces by hand,
 * because hand-aligned ASCII drifts the first time a word changes.
 */
function banner(token: string): string {
  const lines = [
    'No admin account yet. To use /stats, open /stats/setup',
    'and paste this installation key:',
    '',
    `    ${token}`,
    '',
    `Also written to ${SETUP_TOKEN_FILE} in the data directory.`,
    'Set ADMIN_SETUP_OPEN=true to skip the key on a private network,',
    'or STATS_USER and STATS_PASSWORD to configure the login instead.',
  ];

  const width = Math.max(...lines.map((line) => line.length)) + 2;
  const title = ' Sambandscentralen ';
  const top = `┌${title}${'─'.repeat(Math.max(0, width - title.length))}┐`;
  const body = lines.map((line) => `│ ${line.padEnd(width - 1)}│`).join('\n');
  return `\n${top}\n${body}\n└${'─'.repeat(width)}┘\n`;
}

/**
 * The token for this installation, minted on first use and kept until setup
 * completes. It is both logged and written to the data directory, because the
 * two ways an operator loses it are scrolling past the startup line and
 * restarting the container before reading it.
 */
export function getSetupToken(): string {
  const database = getDatabase();
  const row = database.prepare('SELECT value FROM meta WHERE key = ?').get(SETUP_TOKEN_KEY) as
    | { value: string }
    | undefined;
  if (row?.value) return row.value;

  const token = crypto.randomBytes(24).toString('base64url');
  database
    .prepare('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .run(SETUP_TOKEN_KEY, token);

  try {
    // 0600: the data directory may be a bind mount that other things can read.
    fs.writeFileSync(tokenFilePath(), `${token}\n`, { mode: 0o600 });
  } catch (error) {
    console.warn(`[auth] could not write ${tokenFilePath()}: ${String(error)}`);
  }

  console.log(banner(token));

  return token;
}

function consumeSetupToken(): void {
  getDatabase().prepare('DELETE FROM meta WHERE key = ?').run(SETUP_TOKEN_KEY);
  try {
    fs.rmSync(tokenFilePath(), { force: true });
  } catch {
    // Leaving a stale file behind is untidy, not dangerous: the row is gone,
    // so the token it holds no longer opens anything.
  }
}

export function verifySetupToken(provided: string): boolean {
  if (isSetupOpen()) return true;
  const token = getSetupToken();
  return safeEqual(provided.trim(), token);
}
