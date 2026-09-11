import { rfc3339 } from './time.js';
import { logEvent } from './log.js';

export const HEALTH_API_BASE = 'https://health.googleapis.com/v4';
export const DEFAULT_TIMEOUT_MS = 30_000;
export const SESSION_PAGE_SIZE = 25;
export const MAX_SESSIONS = 50;

export function sleepFilter(fromMs, toMsExclusive) {
  return `sleep.interval.end_time >= "${rfc3339(fromMs)}" AND sleep.interval.end_time < "${rfc3339(toMsExclusive)}"`;
}

export function exerciseFilter(fromMs, toMsExclusive) {
  return `exercise.interval.start_time >= "${rfc3339(fromMs)}" AND exercise.interval.start_time < "${rfc3339(toMsExclusive)}"`;
}

export function dataPointName(dataType, id) {
  const raw = String(id || '').trim();
  if (!raw) throw new Error('id is required');
  if (raw.includes('/')) return raw.replace(/^\//, '');
  return `users/me/dataTypes/${dataType}/dataPoints/${raw}`;
}

function queryString(query = {}) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value == null || value === '') continue;
    params.set(key, String(value));
  }
  const text = params.toString();
  return text ? `?${text}` : '';
}

function statusError(status) {
  if (status === 401) return new Error('not authenticated or token expired; re-run scripts/auth.mjs');
  if (status === 403) return new Error('health api denied access');
  if (status === 404) return new Error('health data point not found');
  if (status === 429) return new Error('health api rate limited');
  return new Error(`health api ${status}`);
}

export function createHealthClient({
  getToken,
  fetchImpl = globalThis.fetch,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  maxSessions = MAX_SESSIONS,
} = {}) {
  if (typeof getToken !== 'function') {
    throw new Error('createHealthClient requires getToken');
  }

  async function request(method, path, { query, body } = {}) {
    const token = await getToken();
    const url = `${HEALTH_API_BASE}/${path.replace(/^\//, '')}${queryString(query)}`;
    const headers = {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
    };
    if (body != null) headers['Content-Type'] = 'application/json';

    let res;
    try {
      res = await fetchImpl(url, {
        method,
        headers,
        body: body == null ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (err) {
      if (err?.name === 'TimeoutError' || err?.name === 'AbortError') {
        throw new Error('health api timed out');
      }
      throw new Error('health api request failed');
    }

    if (!res.ok) {
      logEvent('health', 'http_error', { status: res.status, method });
      throw statusError(res.status);
    }

    const text = await res.text();
    if (!text) return {};
    try {
      return JSON.parse(text);
    } catch {
      throw new Error('health api returned invalid json');
    }
  }

  async function reconcileAll(dataType, filter) {
    const dataPoints = [];
    let pageToken;
    let truncated = false;

    while (dataPoints.length < maxSessions) {
      const pageSize = Math.min(SESSION_PAGE_SIZE, maxSessions - dataPoints.length);
      const data = await request('GET', `users/me/dataTypes/${dataType}/dataPoints:reconcile`, {
        query: { filter, pageSize, pageToken },
      });
      const page = Array.isArray(data.dataPoints) ? data.dataPoints : [];
      dataPoints.push(...page);
      pageToken = data.nextPageToken;
      if (!pageToken) break;
      if (dataPoints.length >= maxSessions) {
        truncated = true;
        break;
      }
    }

    return {
      dataPoints: dataPoints.slice(0, maxSessions),
      truncated: truncated || Boolean(pageToken),
    };
  }

  return {
    request,
    reconcileSleep(fromMs, toMsExclusive) {
      return reconcileAll('sleep', sleepFilter(fromMs, toMsExclusive));
    },
    reconcileExercise(fromMs, toMsExclusive) {
      return reconcileAll('exercise', exerciseFilter(fromMs, toMsExclusive));
    },
    getDataPoint(dataType, id) {
      return request('GET', dataPointName(dataType, id));
    },
    dailyRollUp(dataType, fromCivil, toCivilExclusive) {
      return request('POST', `users/me/dataTypes/${dataType}/dataPoints:dailyRollUp`, {
        body: {
          range: {
            start: {
              year: fromCivil.year,
              month: fromCivil.month,
              day: fromCivil.day,
            },
            end: {
              year: toCivilExclusive.year,
              month: toCivilExclusive.month,
              day: toCivilExclusive.day,
            },
          },
          windowSizeDays: 1,
        },
      });
    },
  };
}
