import { spawn } from 'node:child_process';
import { logEvent } from './log.js';

export const DEFAULT_GOG_BIN = '/usr/local/bin/gog';
export const DEFAULT_TIMEOUT_MS = 30_000;
export const DEFAULT_MAX_OUTPUT_BYTES = 102_400;

export const COMMON_FLAGS = Object.freeze([
  '--json',
  '--no-input',
  '--wrap-untrusted',
  '--color=never',
]);

// Leaf paths: --enable-commands-exact does not let parents enable children.
export const EMAIL_COMMANDS =
  'gmail.search,gmail.get,gmail.thread.get,gmail.labels.list';

export const CALENDAR_COMMANDS = [
  'calendar.calendars',
  'calendar.events',
  'calendar.event',
  'calendar.search',
  'calendar.create',
  'calendar.update',
  'calendar.delete',
  'calendar.freebusy',
  'calendar.conflicts',
  'calendar.respond',
].join(',');

export const CALENDAR_DISABLED = [
  'calendar.create-calendar',
  'calendar.delete-calendar',
  'calendar.acl',
  'calendar.subscribe',
  'calendar.unsubscribe',
].join(',');

export function accountFlags(env = process.env) {
  const account = env.GOG_ACCOUNT;
  if (account == null || account === '') return [];
  return ['--account', String(account)];
}

export function emailPrefix(env = process.env) {
  return [
    ...COMMON_FLAGS,
    ...accountFlags(env),
    '--readonly',
    '--gmail-no-send',
    '--enable-commands-exact',
    EMAIL_COMMANDS,
  ];
}

export function calendarPrefix(env = process.env) {
  return [
    ...COMMON_FLAGS,
    ...accountFlags(env),
    '--enable-commands-exact',
    CALENDAR_COMMANDS,
    '--disable-commands',
    CALENDAR_DISABLED,
  ];
}

/** Hardcoded flag plus its value as the next argv slot. */
export function flagValue(flag, value) {
  if (value == null || value === '') return [];
  return [flag, String(value)];
}

/** End-of-options marker so positionals cannot be parsed as gog flags. */
export function positionals(...values) {
  return ['--', ...values.map((value) => String(value))];
}

function sanitizeErrorText(text) {
  if (text == null) return '';
  return String(text)
    .replace(/GOG_KEYRING_PASSWORD=\S+/g, 'GOG_KEYRING_PASSWORD=<redacted>')
    .replace(/password[=:]\s*\S+/gi, 'password=<redacted>')
    .slice(0, 2000);
}

export function parseGogResult(result) {
  if (result?.timedOut) {
    return { ok: false, error: 'gog timed out' };
  }
  if (result?.truncated) {
    return { ok: false, error: 'gog output exceeded capture limit' };
  }
  if ((result?.exitCode ?? 1) !== 0) {
    const detail = sanitizeErrorText(result?.stderr).trim();
    return {
      ok: false,
      error: detail || `gog exited ${result?.exitCode ?? 1}`,
    };
  }
  const text = String(result?.stdout ?? '').trim();
  if (!text) return { ok: true, data: null };
  try {
    return { ok: true, data: JSON.parse(text) };
  } catch {
    return { ok: true, data: text };
  }
}

/**
 * Spawn gog with a fixed argv array. Never uses a shell.
 * `args` must be a string[] — a string is rejected so interpolation cannot sneak in.
 */
export function runGog(args, options = {}) {
  if (!Array.isArray(args)) {
    return Promise.reject(new Error('runGog requires an argv array'));
  }
  for (const arg of args) {
    if (typeof arg !== 'string') {
      return Promise.reject(new Error('runGog args must be strings'));
    }
  }

  const bin = options.bin ?? process.env.GOG_BIN ?? DEFAULT_GOG_BIN;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxBytes = options.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES;

  return new Promise((resolve, reject) => {
    let stdout = Buffer.alloc(0);
    let stderr = Buffer.alloc(0);
    let timedOut = false;
    let truncated = false;
    let settled = false;

    const child = spawn(bin, args, {
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const finish = (payload) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(payload);
    };

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, timeoutMs);

    const append = (current, chunk) => {
      const next = Buffer.concat([current, chunk]);
      if (next.length > maxBytes) {
        truncated = true;
        child.kill('SIGKILL');
        return next.subarray(0, maxBytes);
      }
      return next;
    };

    child.stdout.on('data', (chunk) => {
      stdout = append(stdout, chunk);
    });
    child.stderr.on('data', (chunk) => {
      stderr = append(stderr, chunk);
    });

    child.on('error', (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      logEvent('gog', 'spawn_error', { name: err?.name });
      reject(err);
    });

    child.on('close', (code) => {
      logEvent('gog', 'run', {
        exitCode: code,
        timedOut,
        truncated,
        argCount: args.length,
      });
      finish({
        exitCode: code ?? 1,
        stdout: stdout.toString('utf8'),
        stderr: stderr.toString('utf8'),
        timedOut,
        truncated,
      });
    });
  });
}
