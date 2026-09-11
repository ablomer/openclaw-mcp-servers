/**
 * Structured logs never include health payloads, queries, tokens, or secrets.
 */
export function logEvent(scope, event, extra = {}) {
  const forbidden = new Set([
    'body',
    'text',
    'note',
    'query',
    'summary',
    'description',
    'raw_json',
    'rawjson',
    'stdout',
    'stderr',
    'argv',
    'args',
    'cookie',
    'cookies',
    'token',
    'password',
    'authorization',
    'caption',
    'refresh_token',
    'access_token',
    'id_token',
    'client_secret',
    'code',
  ]);
  const safe = {};
  for (const [key, value] of Object.entries(extra)) {
    if (forbidden.has(key.toLowerCase())) continue;
    safe[key] = value;
  }
  console.log(JSON.stringify({ ts: Date.now(), scope, event, ...safe }));
}
