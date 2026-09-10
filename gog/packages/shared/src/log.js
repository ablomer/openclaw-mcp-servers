/**
 * Structured logs never include mail/event bodies, queries, tokens, or keyring secrets.
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
  ]);
  const safe = {};
  for (const [key, value] of Object.entries(extra)) {
    if (forbidden.has(key.toLowerCase())) continue;
    safe[key] = value;
  }
  console.log(JSON.stringify({ ts: Date.now(), scope, event, ...safe }));
}
