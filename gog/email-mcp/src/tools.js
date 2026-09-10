import {
  emailPrefix,
  flagValue,
  parseGogResult,
  positionals,
  runGog as defaultRunGog,
} from '@openclaw-gog/shared';
import { clampInt, truncatePayload } from './validate.js';

function textResult(payload) {
  return {
    content: [{ type: 'text', text: truncatePayload(payload) }],
  };
}

function errorResult(message) {
  return {
    isError: true,
    content: [{ type: 'text', text: message }],
  };
}

async function invoke(exec, args) {
  try {
    const result = await exec(args);
    const parsed = parseGogResult(result);
    if (!parsed.ok) return errorResult(parsed.error);
    return textResult(parsed.data);
  } catch (err) {
    return errorResult(err?.message || 'gog failed');
  }
}

export function createTools({ runGog } = {}) {
  const exec = runGog ?? defaultRunGog;
  const prefix = () => emailPrefix();

  return {
    searchMessages({ query, max } = {}) {
      const n = clampInt(max, 10, 1, 50);
      return invoke(exec, [
        ...prefix(),
        'gmail',
        'search',
        '--max',
        String(n),
        ...positionals(query),
      ]);
    },

    getMessage({ id, format } = {}) {
      return invoke(exec, [
        ...prefix(),
        'gmail',
        'get',
        '--sanitize-content',
        ...flagValue('--format', format === 'metadata' ? 'metadata' : 'full'),
        ...positionals(id),
      ]);
    },

    getThread({ id } = {}) {
      return invoke(exec, [
        ...prefix(),
        'gmail',
        'thread',
        'get',
        '--sanitize-content',
        ...positionals(id),
      ]);
    },

    listLabels() {
      return invoke(exec, [...prefix(), 'gmail', 'labels', 'list']);
    },
  };
}
