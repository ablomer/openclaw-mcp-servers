import { civilKey, displayRecordedAt } from '@openclaw-google-health/shared';

const LOCATION_KEYS = new Set([
  'gps',
  'hasgps',
  'has_gps',
  'location',
  'locations',
  'route',
  'routes',
  'latitude',
  'longitude',
  'lat',
  'lng',
  'lon',
  'coordinates',
  'tcx',
  'exporttcx',
  'gpscoordinates',
  'gps_coordinates',
]);

function pick(obj, keys) {
  if (!obj || typeof obj !== 'object') return undefined;
  for (const key of keys) {
    if (obj[key] != null) return obj[key];
  }
  return undefined;
}

function parseTimeMs(value) {
  if (value == null || value === '') return null;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const ms = Date.parse(String(value));
  return Number.isFinite(ms) ? ms : null;
}

function intervalTimes(interval) {
  const start = parseTimeMs(pick(interval, ['startTime', 'start_time']));
  const end = parseTimeMs(pick(interval, ['endTime', 'end_time']));
  return { startMs: start, endMs: end };
}

function round1(n) {
  return Math.round(n * 10) / 10;
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

export function dataPointId(name) {
  if (name == null || name === '') return null;
  const parts = String(name).split('/').filter(Boolean);
  return parts[parts.length - 1] || String(name);
}

export function durationHours(startMs, endMs) {
  if (startMs == null || endMs == null || endMs < startMs) return null;
  return round2((endMs - startMs) / 3_600_000);
}

export function durationMinutes(startMs, endMs) {
  if (startMs == null || endMs == null || endMs < startMs) return null;
  return round1((endMs - startMs) / 60_000);
}

export function stageMinutes(stages) {
  const out = { light: 0, deep: 0, rem: 0, awake: 0 };
  for (const stage of stages || []) {
    const type = String(stage?.type || stage?.stageType || '').toUpperCase();
    const { startMs, endMs } = intervalTimes(stage);
    const minutes = startMs != null && endMs != null && endMs >= startMs ? (endMs - startMs) / 60_000 : 0;
    if (type.includes('DEEP')) out.deep += minutes;
    else if (type.includes('REM')) out.rem += minutes;
    else if (type.includes('WAKE')) out.awake += minutes;
    else if (type.includes('LIGHT')) out.light += minutes;
  }
  return {
    light: round1(out.light),
    deep: round1(out.deep),
    rem: round1(out.rem),
    awake: round1(out.awake),
  };
}

function formatStages(stages) {
  return (stages || []).map((stage) => {
    const { startMs, endMs } = intervalTimes(stage);
    return {
      display_start: displayRecordedAt(startMs),
      display_end: displayRecordedAt(endMs),
      type: String(stage?.type || stage?.stageType || 'UNKNOWN'),
      minutes: durationMinutes(startMs, endMs),
    };
  });
}

export function formatSleep(point, { detail = false } = {}) {
  const sleep = point?.sleep || {};
  const { startMs, endMs } = intervalTimes(sleep.interval);
  const stages = sleep.stages || sleep.sleepStages || [];
  const shortAwakenings = sleep.shortAwakenings || sleep.short_awakenings || [];
  return {
    id: dataPointId(point?.name),
    display_start: displayRecordedAt(startMs),
    display_end: displayRecordedAt(endMs),
    duration_hours: durationHours(startMs, endMs),
    type: sleep.type || sleep.sleepType || null,
    stage_minutes: stageMinutes(stages),
    short_awakening_count: Array.isArray(shortAwakenings) ? shortAwakenings.length : 0,
    ...(detail ? { stages: formatStages(stages) } : {}),
  };
}

function firstNumber(obj, keys) {
  if (!obj || typeof obj !== 'object') return null;
  for (const key of keys) {
    const value = obj[key];
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) {
      return Number(value);
    }
  }
  return null;
}

function distanceMeters(summary) {
  const mm = firstNumber(summary, [
    'distanceMillimeters',
    'distance_millimeters',
    'distanceMm',
    'distance_mm',
    'elevationGainMillimeters',
  ]);
  if (mm != null) return round1(mm / 1000);
  const meters = firstNumber(summary, ['distanceMeters', 'distance_meters', 'distanceM', 'distance']);
  return meters == null ? null : round1(meters);
}

export function stripLocation(value) {
  if (Array.isArray(value)) return value.map(stripLocation);
  if (!value || typeof value !== 'object') return value;
  const out = {};
  for (const [key, child] of Object.entries(value)) {
    if (LOCATION_KEYS.has(key.toLowerCase())) continue;
    out[key] = stripLocation(child);
  }
  return out;
}

export function formatExercise(point, { detail = false } = {}) {
  const exercise = point?.exercise || {};
  const { startMs, endMs } = intervalTimes(exercise.interval);
  const meta = exercise.exerciseMetadata || exercise.metadata || {};
  const summary = exercise.metricsSummary || exercise.summary || {};
  const cleaned = detail ? stripLocation(exercise) : null;
  return {
    id: dataPointId(point?.name),
    activity_type: pick(meta, ['activityType', 'activity_type', 'type']) || pick(exercise, ['activityType', 'type']) || null,
    display_start: displayRecordedAt(startMs),
    display_end: displayRecordedAt(endMs),
    duration_min: durationMinutes(startMs, endMs),
    calories: firstNumber(summary, ['calories', 'totalCalories', 'caloriesBurned', 'energyKcal']),
    distance_m: distanceMeters(summary),
    steps: firstNumber(summary, ['steps', 'stepCount', 'step_count']),
    avg_hr: firstNumber(summary, [
      'averageHeartRate',
      'avgHeartRate',
      'heartRateAverage',
      'averageHeartRateBpm',
    ]),
    ...(detail
      ? {
          events: cleaned?.events || cleaned?.eventIntervals || undefined,
          laps: cleaned?.laps || cleaned?.splits || undefined,
        }
      : {}),
  };
}

function civilFromRollup(point) {
  const start = point?.civilStartTime || point?.civil_start_time;
  if (!start) return null;
  if (start.year != null) {
    return { year: Number(start.year), month: Number(start.month), day: Number(start.day) };
  }
  if (typeof start === 'string' && /^\d{4}-\d{2}-\d{2}/.test(start)) {
    const [year, month, day] = start.slice(0, 10).split('-').map(Number);
    return { year, month, day };
  }
  return null;
}

function rollupNumber(value) {
  if (value == null) return null;
  if (typeof value === 'number') return value;
  if (typeof value !== 'object') return null;
  const named = firstNumber(value, [
    'countSum',
    'count_sum',
    'minutesSum',
    'minutes_sum',
    'caloriesSum',
    'calories_sum',
    'energyKcalSum',
    'kilocaloriesSum',
    'totalCaloriesSum',
    'sum',
  ]);
  if (named != null) return named;
  for (const child of Object.values(value)) {
    if (typeof child === 'number' && Number.isFinite(child)) return child;
  }
  return null;
}

export function formatActivityDays(stepsRes, activeRes, caloriesRes) {
  const byDate = new Map();

  const ingest = (res, field, extractor) => {
    const points = res?.rollupDataPoints || res?.dataPoints || [];
    for (const point of points) {
      const civil = civilFromRollup(point);
      if (!civil) continue;
      const key = civilKey(civil);
      const row = byDate.get(key) || { date: key, steps: null, active_minutes: null, calories: null };
      row[field] = extractor(point);
      byDate.set(key, row);
    }
  };

  ingest(stepsRes, 'steps', (p) => rollupNumber(p.steps));
  ingest(activeRes, 'active_minutes', (p) => rollupNumber(p.activeMinutes || p.active_minutes));
  ingest(caloriesRes, 'calories', (p) => rollupNumber(p.totalCalories || p.total_calories));

  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
}
