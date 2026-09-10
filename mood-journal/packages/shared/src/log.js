/**
 * Structured logs never include journal notes, raw payloads, cookies, or tokens.
 */
export function logEvent(scope, event, extra = {}) {
  const forbidden = new Set([
    'body',
    'text',
    'note',
    'raw_json',
    'rawjson',
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
