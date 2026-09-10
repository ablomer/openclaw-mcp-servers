const FTS_OPS = /\b(AND|OR|NOT|NEAR)\b/gi;

export function escapeFtsQuery(query) {
  const stripped = String(query ?? '')
    .replace(/["'*(){}[\]^~:]+/g, ' ')
    .replace(FTS_OPS, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (stripped.length < 2) {
    throw new Error('query must contain at least 2 alphanumeric characters');
  }
  return `"${stripped}"`;
}
