import { createHealthClient, createOAuthClient, getAccessToken } from '@openclaw-google-health/shared';
import { formatActivityDays, formatExercise, formatSleep } from './format.js';
import { resolveToolWindow, truncatePayload } from './validate.js';

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

function defaultClient() {
  const { client } = createOAuthClient();
  return createHealthClient({
    getToken: () => getAccessToken(client),
  });
}

async function withClient(getApi, fn) {
  try {
    const api = typeof getApi === 'function' ? getApi() : getApi;
    return textResult(await fn(api));
  } catch (err) {
    return errorResult(err?.message || 'health api failed');
  }
}

export function createTools({ client } = {}) {
  const getApi = () => client ?? defaultClient();

  return {
    listSleep(args = {}) {
      return withClient(getApi, async (health) => {
        const window = resolveToolWindow(args, { defaultDays: 7, maxDays: 90 });
        const { dataPoints, truncated } = await health.reconcileSleep(window.fromMs, window.toMsExclusive);
        return {
          sessions: dataPoints.map((point) => formatSleep(point)),
          truncated,
        };
      });
    },

    getSleep({ id } = {}) {
      return withClient(getApi, async (health) => {
        const point = await health.getDataPoint('sleep', id);
        return { session: formatSleep(point, { detail: true }) };
      });
    },

    listExercises(args = {}) {
      return withClient(getApi, async (health) => {
        const window = resolveToolWindow(args, { defaultDays: 7, maxDays: 90 });
        const { dataPoints, truncated } = await health.reconcileExercise(window.fromMs, window.toMsExclusive);
        return {
          sessions: dataPoints.map((point) => formatExercise(point)),
          truncated,
        };
      });
    },

    getExercise({ id } = {}) {
      return withClient(getApi, async (health) => {
        const point = await health.getDataPoint('exercise', id);
        return { session: formatExercise(point, { detail: true }) };
      });
    },

    summarizeActivity(args = {}) {
      return withClient(getApi, async (health) => {
        const window = resolveToolWindow(args, { defaultDays: 7, maxDays: 14 });
        const [steps, active, calories] = await Promise.all([
          health.dailyRollUp('steps', window.fromCivil, window.toCivilExclusive),
          health.dailyRollUp('active-minutes', window.fromCivil, window.toCivilExclusive),
          health.dailyRollUp('total-calories', window.fromCivil, window.toCivilExclusive),
        ]);
        return { days: formatActivityDays(steps, active, calories) };
      });
    },
  };
}
