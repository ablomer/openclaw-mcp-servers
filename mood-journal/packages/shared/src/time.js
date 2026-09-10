export const TZ = process.env.TZ || 'America/New_York';

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const WEEKDAY_OFFSET = {
  Monday: 0,
  Tuesday: 1,
  Wednesday: 2,
  Thursday: 3,
  Friday: 4,
  Saturday: 5,
  Sunday: 6,
};

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

export function displayRecordedAt(ms) {
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
    throw new Error('invalid date; use YYYY-MM-DD, YYYY-MM-DDTHH:mm, or a display_recorded_at value');
  }

  if (dateOnly && bound === 'end') {
    return zonedLocalToUtcMs(year, month, day + 1, 0, 0, 0) - 1;
  }
  return zonedLocalToUtcMs(year, month, day, hour, minute, second);
}

export function periodKey(ms, period) {
  const parts = getTzParts(ms);
  if (period === 'day') {
    return `${pad(parts.year, 4)}-${pad(parts.month, 2)}-${pad(parts.day, 2)}`;
  }
  if (period === 'month') {
    return `${pad(parts.year, 4)}-${pad(parts.month, 2)}`;
  }
  if (period === 'week') {
    const start = startOfIsoWeek(ms);
    const startParts = getTzParts(start);
    return `${pad(startParts.year, 4)}-${pad(startParts.month, 2)}-${pad(startParts.day, 2)}`;
  }
  throw new Error('invalid period');
}

export function startOfIsoWeek(ms) {
  const parts = getTzParts(ms);
  const offset = WEEKDAY_OFFSET[parts.weekday];
  const utcDay = Date.UTC(parts.year, parts.month - 1, parts.day);
  const monday = new Date(utcDay);
  monday.setUTCDate(monday.getUTCDate() - offset);
  return zonedLocalToUtcMs(monday.getUTCFullYear(), monday.getUTCMonth() + 1, monday.getUTCDate(), 0, 0, 0);
}

export function weekdayName(ms) {
  return getTzParts(ms).weekday;
}

export { WEEKDAYS };

function pad(n, width) {
  return String(n).padStart(width, '0');
}
