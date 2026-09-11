import { createGenerator } from './generate.js';
import { truncatePayload } from './validate.js';

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

export function createTools(deps = {}) {
  const generator = deps.generator || createGenerator(deps);

  return {
    async generateContext() {
      try {
        const context = await generator.generate();
        return textResult(context);
      } catch (err) {
        return errorResult(err?.message || 'generate_context failed');
      }
    },
  };
}
