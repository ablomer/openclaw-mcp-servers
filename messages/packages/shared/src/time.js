export const TZ = process.env.TZ || 'America/New_York';

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const DATETIME_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;
const DISPLAY_RE =
  /^(Sunday|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday), (\d{4}-\d{2}-\d{2}) (\d{1,2}):(\d{2})(?::(\d{2}))? (AM|PM) [A-Z]+$/i;

function tzFormatter(options) {
  return new Intl.DateTimeFormat('en-US', { timeZone: TZ, ...options });
}

export function getTzParts(ms) {
  const parts = tzFormatter({
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
    weekday: 'long',
  }).formatToParts(new Date(ms));
  const map = Object.fromEntries(parts.filter((p) => p.type !== 'literal').map((p) => [p.type, p.value]));
  return {
    year: Number(map.year),
    month: Number(map.month),
    day: Number(map.day),
    hour: Number(map.hour),
    minute: Number(map.minute),
    second: Number(map.second),
    weekday: map.weekday,
  };
}

export function zonedLocalToUtcMs(year, month, day, hour = 0, minute = 0, second = 0) {
  const utcGuess = Date.UTC(year, month - 1, day, hour, minute, second, 0);
  const parts = getTzParts(utcGuess);
  const asIfUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second, 0);
  return utcGuess - (asIfUtc - utcGuess);
}

export function displayTime(ms) {
  if (ms == null || !Number.isFinite(ms)) return null;
  const parts = getTzParts(ms);
  const date = `${pad(parts.year, 4)}-${pad(parts.month, 2)}-${pad(parts.day, 2)}`;
  let hour = parts.hour % 12;
  if (hour === 0) hour = 12;
  const meridiem = parts.hour >= 12 ? 'PM' : 'AM';
  const time = `${hour}:${pad(parts.minute, 2)}:${pad(parts.second, 2)} ${meridiem}`;
  const tzName = tzFormatter({ timeZoneName: 'short' })
    .formatToParts(new Date(ms))
    .find((p) => p.type === 'timeZoneName')?.value;
  return `${parts.weekday}, ${date} ${time} ${tzName}`;
}

function to24h(hour12, meridiem) {
  let hour = Number(hour12) % 12;
  if (String(meridiem).toUpperCase() === 'PM') hour += 12;
  return hour;
}

export function parseDateArg(value, { bound = 'start' } = {}) {
  if (value == null || value === '') return null;
  const raw = String(value).trim();

  let year;
  let month;
  let day;
  let hour = 0;
  let minute = 0;
  let second = 0;
  let dateOnly = false;

  const dateMatch = DATE_RE.exec(raw);
  const dateTimeMatch = DATETIME_RE.exec(raw);
  const displayMatch = DISPLAY_RE.exec(raw);

  if (dateMatch) {
    year = Number(dateMatch[1]);
    month = Number(dateMatch[2]);
    day = Number(dateMatch[3]);
    dateOnly = true;
  } else if (dateTimeMatch) {
    year = Number(dateTimeMatch[1]);
    month = Number(dateTimeMatch[2]);
    day = Number(dateTimeMatch[3]);
    hour = Number(dateTimeMatch[4]);
    minute = Number(dateTimeMatch[5]);
  } else if (displayMatch) {
    const dateParts = displayMatch[2].split('-').map(Number);
    year = dateParts[0];
    month = dateParts[1];
    day = dateParts[2];
    hour = to24h(displayMatch[3], displayMatch[6]);
    minute = Number(displayMatch[4]);
    second = displayMatch[5] == null ? 0 : Number(displayMatch[5]);
  } else {
    throw new Error(
      'invalid date; use YYYY-MM-DD, YYYY-MM-DDTHH:mm, or a weekday timestamp like Tuesday, 2026-09-08 10:00:00 AM EDT',
    );
  }

  if (dateOnly && bound === 'end') {
    return zonedLocalToUtcMs(year, month, day + 1, 0, 0, 0) - 1;
  }
  return zonedLocalToUtcMs(year, month, day, hour, minute, second);
}

export function civilFromMs(ms) {
  const parts = getTzParts(ms);
  return { year: parts.year, month: parts.month, day: parts.day };
}

export function civilKey(civil) {
  return `${pad(civil.year, 4)}-${pad(civil.month, 2)}-${pad(civil.day, 2)}`;
}

export function civilDayDiff(fromCivil, toCivil) {
  const from = Date.UTC(fromCivil.year, fromCivil.month - 1, fromCivil.day);
  const to = Date.UTC(toCivil.year, toCivil.month - 1, toCivil.day);
  return Math.round((to - from) / 86_400_000);
}

function startOfToday(nowMs) {
  const parts = getTzParts(nowMs);
  return zonedLocalToUtcMs(parts.year, parts.month, parts.day, 0, 0, 0);
}

function startOfTomorrow(nowMs) {
  const parts = getTzParts(nowMs);
  return zonedLocalToUtcMs(parts.year, parts.month, parts.day + 1, 0, 0, 0);
}

function exclusiveEndFromToArg(value) {
  const raw = String(value).trim();
  if (DATE_RE.test(raw)) {
    const match = DATE_RE.exec(raw);
    return zonedLocalToUtcMs(Number(match[1]), Number(match[2]), Number(match[3]) + 1, 0, 0, 0);
  }
  return parseDateArg(raw, { bound: 'start' });
}

/**
 * Inclusive calendar-day window in America/New_York (or TZ).
 * `from` / `to` are YYYY-MM-DD (date-only `to` includes that whole day).
 */
export function resolveDayRange(
  args = {},
  { defaultDays = 3, maxDays = 14, nowMs = Date.now() } = {},
) {
  const today = Boolean(args.today);
  const hasFrom = args.from != null && args.from !== '';
  const hasTo = args.to != null && args.to !== '';
  const hasDays = args.days != null && args.days !== '';
  if (today && (hasFrom || hasTo || hasDays)) {
    throw new Error('use only one of today, days, or from/to');
  }
  if (hasDays && (hasFrom || hasTo)) {
    throw new Error('use only one of days or from/to');
  }

  let fromMs;
  let toMsExclusive;
  const nowParts = getTzParts(nowMs);
  const nowStart = startOfToday(nowMs);
  const tomorrow = startOfTomorrow(nowMs);

  if (today) {
    fromMs = nowStart;
    toMsExclusive = tomorrow;
  } else if (hasDays) {
    const n = Number(args.days);
    if (!Number.isFinite(n)) throw new Error('days must be a number');
    const days = Math.min(maxDays, Math.max(1, Math.trunc(n)));
    fromMs = zonedLocalToUtcMs(nowParts.year, nowParts.month, nowParts.day - (days - 1), 0, 0, 0);
    toMsExclusive = tomorrow;
  } else if (hasFrom || hasTo) {
    fromMs = hasFrom ? parseDateArg(args.from, { bound: 'start' }) : null;
    toMsExclusive = hasTo ? exclusiveEndFromToArg(args.to) : tomorrow;
    if (fromMs == null) {
      const toCivil = civilFromMs(toMsExclusive);
      fromMs = zonedLocalToUtcMs(toCivil.year, toCivil.month, toCivil.day - defaultDays, 0, 0, 0);
    }
  } else {
    fromMs = zonedLocalToUtcMs(
      nowParts.year,
      nowParts.month,
      nowParts.day - (defaultDays - 1),
      0,
      0,
      0,
    );
    toMsExclusive = tomorrow;
  }

  if (!(fromMs < toMsExclusive)) {
    throw new Error('from must be before to');
  }

  const fromCivil = civilFromMs(fromMs);
  const toCivilExclusive = civilFromMs(toMsExclusive);
  const dayCount = civilDayDiff(fromCivil, toCivilExclusive);
  if (dayCount > maxDays) {
    throw new Error(`range exceeds ${maxDays} days`);
  }

  const lastDay = zonedLocalToUtcMs(
    toCivilExclusive.year,
    toCivilExclusive.month,
    toCivilExclusive.day - 1,
    0,
    0,
    0,
  );
  return {
    fromMs,
    toMsExclusive,
    from: civilKey(fromCivil),
    to: civilKey(civilFromMs(lastDay)),
    dayCount,
  };
}

function pad(n, width) {
  return String(n).padStart(width, '0');
}
