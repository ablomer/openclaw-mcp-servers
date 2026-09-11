import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { OAuth2Client } from 'google-auth-library';
import { logEvent } from './log.js';

export const SCOPES = Object.freeze([
  'https://www.googleapis.com/auth/googlehealth.sleep.readonly',
  'https://www.googleapis.com/auth/googlehealth.activity_and_fitness.readonly',
]);

export function dataDir(env = process.env) {
  return env.GOOGLE_HEALTH_DATA_DIR || '/data';
}

export function credentialsPath(env = process.env) {
  return join(dataDir(env), 'credentials.json');
}

export function tokenPath(env = process.env) {
  return join(dataDir(env), 'token.json');
}

export function hasToken(env = process.env) {
  return existsSync(tokenPath(env));
}

export function parseCredentials(json) {
  const block = json?.installed || json?.web;
  if (!block?.client_id || !block?.client_secret) {
    throw new Error('credentials.json missing client_id or client_secret');
  }
  const redirect =
    Array.isArray(block.redirect_uris) && block.redirect_uris[0]
      ? String(block.redirect_uris[0])
      : 'https://www.google.com';
  return {
    client_id: String(block.client_id),
    client_secret: String(block.client_secret),
    redirect_uri: redirect,
  };
}

export function loadCredentials(env = process.env) {
  const path = credentialsPath(env);
  if (!existsSync(path)) {
    throw new Error('credentials.json not found; see HOST_NOTES.txt');
  }
  return parseCredentials(JSON.parse(readFileSync(path, 'utf8')));
}

export function loadTokens(env = process.env) {
  const path = tokenPath(env);
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
}

export function persistTokens(newTokens, env = process.env) {
  const path = tokenPath(env);
  const current = loadTokens(env) || {};
  const merged = { ...current, ...newTokens };
  if (!merged.refresh_token && current.refresh_token) {
    merged.refresh_token = current.refresh_token;
  }
  writeFileSync(path, `${JSON.stringify(merged, null, 2)}\n`, { mode: 0o600 });
}

export function createOAuthClient(env = process.env) {
  const creds = loadCredentials(env);
  const client = new OAuth2Client(creds.client_id, creds.client_secret, creds.redirect_uri);
  const tokens = loadTokens(env);
  if (tokens) client.setCredentials(tokens);
  client.on('tokens', (next) => {
    try {
      persistTokens(next, env);
      logEvent('auth', 'tokens_persisted');
    } catch (err) {
      logEvent('auth', 'tokens_persist_failed', { name: err?.name });
    }
  });
  return { client, creds };
}

export async function getAccessToken(oauth = createOAuthClient()) {
  const client = oauth.client ?? oauth;
  const result = await client.getAccessToken();
  if (!result?.token) {
    throw new Error('not authenticated; run scripts/auth.mjs');
  }
  return result.token;
}
