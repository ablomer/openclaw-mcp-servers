#!/usr/bin/env node
/**
 * One-shot OAuth for the Google Health MCP.
 * Never run this from OpenClaw. Writes token.json next to credentials.json.
 *
 *   GOOGLE_HEALTH_DATA_DIR=/path/to/google-health-data node scripts/auth.mjs
 */
import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import {
  SCOPES,
  createOAuthClient,
  persistTokens,
  tokenPath,
} from '@openclaw-google-health/shared';

const { client } = createOAuthClient();
const url = client.generateAuthUrl({
  access_type: 'offline',
  prompt: 'consent',
  scope: SCOPES,
});

console.log('Open this URL, grant access, then paste the code from the redirect URL.');
console.log(url);
console.log('');

const rl = createInterface({ input, output });
const code = (await rl.question('Authorization code: ')).trim();
rl.close();

if (!code) {
  console.error('No code provided.');
  process.exit(1);
}

const { tokens } = await client.getToken(code);
if (!tokens.refresh_token) {
  console.error('No refresh_token returned. Re-consent with prompt=consent and try again.');
  process.exit(1);
}

persistTokens(tokens);
console.log(`Wrote ${tokenPath()}`);
console.log('Publish the OAuth app to "In production" so the refresh token does not expire in 7 days.');
