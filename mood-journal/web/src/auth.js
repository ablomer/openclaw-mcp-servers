import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

export const COOKIE = 'mj_session';
const MAX_AGE_SEC = 7 * 24 * 60 * 60;
const WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILURES = 8;

export function passwordsMatch(input, expected) {
  const a = createHash('sha256').update(String(input), 'utf8').digest();
  const b = createHash('sha256').update(String(expected), 'utf8').digest();
  return timingSafeEqual(a, b);
}

export function signSession(password, now = Date.now()) {
  const payload = String(now + MAX_AGE_SEC * 1000);
  const sig = createHmac('sha256', password).update(payload).digest('base64url');
  return `${payload}.${sig}`;
}

export function verifySession(token, password, now = Date.now()) {
  if (typeof token !== 'string' || typeof password !== 'string' || !password) return false;
  const dot = token.indexOf('.');
  if (dot <= 0 || dot !== token.lastIndexOf('.')) return false;
  const payload = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  if (!/^\d+$/.test(payload)) return false;
  if (Number(payload) < now) return false;
  const expected = createHmac('sha256', password).update(payload).digest('base64url');
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export function readCookie(header, name) {
  if (!header) return null;
  for (const part of String(header).split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() !== name) continue;
    try {
      return decodeURIComponent(part.slice(eq + 1).trim());
    } catch {
      return null;
    }
  }
  return null;
}

export function sessionCookie(token, { secure = false, clear = false } = {}) {
  const parts = [
    `${COOKIE}=${clear ? '' : encodeURIComponent(token)}`,
    'HttpOnly',
    'SameSite=Lax',
    'Path=/',
    `Max-Age=${clear ? 0 : MAX_AGE_SEC}`,
  ];
  if (secure) parts.push('Secure');
  return parts.join('; ');
}

export function createLoginLimiter() {
  const failures = new Map();
  return {
    isLimited(ip, now = Date.now()) {
      const row = failures.get(ip);
      if (!row || row.resetAt <= now) return false;
      return row.count >= MAX_FAILURES;
    },
    recordFailure(ip, now = Date.now()) {
      const row = failures.get(ip);
      if (!row || row.resetAt <= now) {
        failures.set(ip, { count: 1, resetAt: now + WINDOW_MS });
        return;
      }
      row.count += 1;
    },
    clear(ip) {
      failures.delete(ip);
    },
  };
}
