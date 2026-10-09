// Pure calendar maths for the calendar-sync function. The ical.js module is
// injected so this file runs unchanged in Deno (npm:ical.js) and in Node tests.

export const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

// Offset (ms) of `tz` from UTC at the given instant.
export function tzOffsetMs(epoch, tz) {
  const f = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
  const p = Object.fromEntries(f.formatToParts(new Date(epoch)).map((x) => [x.type, x.value]));
  const asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
  return asUtc - Math.floor(epoch / 1000) * 1000;
}

// Epoch ms for a wall-clock time (month is 1-12) in `tz`.
export function zonedEpoch(y, m, d, hh, mm, tz) {
  const guess = Date.UTC(y, m - 1, d, hh, mm);
  const first = guess - tzOffsetMs(guess, tz);
  return guess - tzOffsetMs(first, tz);
}

export function todayIn(tz, now = new Date()) {
  const f = new Intl.DateTimeFormat('en-US', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' });
  const p = Object.fromEntries(f.formatToParts(now).map((x) => [x.type, x.value]));
  const y = +p.year, m = +p.month, d = +p.day;
  return { y, m, d, weekday: new Date(Date.UTC(y, m - 1, d)).getUTCDay() };
}

// "12:15–13:45" -> [12, 15, 13, 45]
const parseLabel = (label) => {
  const m = /(\d{1,2}):(\d{2})\s*[–-]\s*(\d{1,2}):(\d{2})/.exec(label || '');
  return m ? [+m[1], +m[2], +m[3], +m[4]] : null;
};

// The date a weekly shift is shown for: today if it falls on that weekday (even once the
// shift is over, until midnight), otherwise the next such day. Returns { y, m, d }.
export function shiftDate(dayName, tz, now = new Date()) {
  const target = WEEKDAYS.indexOf(dayName);
  if (target < 0) return null;
  const t = todayIn(tz, now);
  const d = new Date(Date.UTC(t.y, t.m - 1, t.d + ((target - t.weekday + 7) % 7)));
  return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, d: d.getUTCDate() };
}

export const dateKey = ({ y, m, d }) => `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
export const parseDateKey = (key) => {
  const [y, m, d] = String(key).split('-').map(Number);
  return { y, m, d };
};

// Start and end (epoch ms) of a shift label such as "12:15–13:45" on the given date.
export function occurrenceOn(date, label, tz) {
  const p = parseLabel(label);
  if (!p) return null;
  return {
    start: zonedEpoch(date.y, date.m, date.d, p[0], p[1], tz),
    end: zonedEpoch(date.y, date.m, date.d, p[2], p[3], tz),
  };
}

// The occurrence the schedule shows for a weekly shift: { date: 'YYYY-MM-DD', start, end }.
export function shiftOccurrence(dayName, label, tz, now = new Date()) {
  const date = shiftDate(dayName, tz, now);
  const occ = date && occurrenceOn(date, label, tz);
  return occ ? { date: dateKey(date), ...occ } : null;
}

// [start, end) of the calendar day (midnight to midnight, in `tz`) containing `epoch`.
export function localDayBounds(epoch, tz) {
  const t = todayIn(tz, new Date(epoch));
  const next = new Date(Date.UTC(t.y, t.m - 1, t.d + 1));
  return [
    zonedEpoch(t.y, t.m, t.d, 0, 0, tz),
    zonedEpoch(next.getUTCFullYear(), next.getUTCMonth() + 1, next.getUTCDate(), 0, 0, tz),
  ];
}

// Next occurrence (not yet finished) of a weekly shift such as ("Monday", "12:15–13:45").
export function nextOccurrence(dayName, timeLabel, tz, now = new Date()) {
  const m = /(\d{1,2}):(\d{2})\s*[–-]\s*(\d{1,2}):(\d{2})/.exec(timeLabel);
  const target = WEEKDAYS.indexOf(dayName);
  if (!m || target < 0) return null;
  const [sh, sm, eh, em] = [+m[1], +m[2], +m[3], +m[4]];
  const t = todayIn(tz, now);
  let add = (target - t.weekday + 7) % 7;
  for (let i = 0; i < 2; i++, add += 7) {
    const day = new Date(Date.UTC(t.y, t.m - 1, t.d + add));
    const [y, mo, d] = [day.getUTCFullYear(), day.getUTCMonth() + 1, day.getUTCDate()];
    const start = zonedEpoch(y, mo, d, sh, sm, tz);
    const end = zonedEpoch(y, mo, d, eh, em, tz);
    if (end > now.getTime()) return { start, end };
  }
  return null;
}

const validTz = (tz) => {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
};

// Busy [startMs, endMs] intervals between `from` and `to` (epoch ms) from an iCal feed.
// Ignores all-day, cancelled and "free" (transparent) events.
// Times whose timezone the feed doesn't define (a TZID with no VTIMEZONE, or no zone at all)
// are "floating" for ical.js, which would read them in the server's zone (UTC) and shift them
// by hours. They are read in the event's own TZID when it is a real IANA zone, else `defaultTz`.
export function busyIntervals(ICAL, icsText, from, to, defaultTz = 'Europe/Paris') {
  ICAL.TimezoneService.reset();

  const epochOf = (tm, tzid) => {
    if (tm.zone === ICAL.Timezone.localTimezone) {
      return zonedEpoch(tm.year, tm.month, tm.day, tm.hour, tm.minute, tzid && validTz(tzid) ? tzid : defaultTz);
    }
    return tm.toJSDate().getTime();
  };
  const tzidOf = (ev, prop) => ev.component.getFirstProperty(prop)?.getParameter('tzid');
  const root = new ICAL.Component(ICAL.parse(icsText));
  for (const vtz of root.getAllSubcomponents('vtimezone')) {
    try { ICAL.TimezoneService.register(vtz); } catch { /* unknown zone: fall back to UTC */ }
  }

  const masters = new Map();
  const exceptions = [];
  for (const c of root.getAllSubcomponents('vevent')) {
    const ev = new ICAL.Event(c);
    if (ev.recurrenceId) exceptions.push(ev);
    else masters.set(ev.uid, ev);
  }
  for (const ex of exceptions) masters.get(ex.uid)?.relateException(ex);

  const out = [];
  const push = (s, e) => { if (e > from && s < to) out.push([s, e]); };
  const skip = (ev) =>
    String(ev.component.getFirstPropertyValue('status') || '').toUpperCase() === 'CANCELLED' ||
    String(ev.component.getFirstPropertyValue('transp') || '').toUpperCase() === 'TRANSPARENT' ||
    ev.startDate.isDate;

  for (const ev of masters.values()) {
    if (skip(ev)) continue;
    const startTz = tzidOf(ev, 'dtstart');
    const endTz = tzidOf(ev, 'dtend') ?? startTz;
    if (!ev.isRecurring()) {
      push(epochOf(ev.startDate, startTz), epochOf(ev.endDate, endTz));
      continue;
    }
    const it = ev.iterator();
    let next;
    for (let n = 0; (next = it.next()) && n < 6000; n++) {
      const d = ev.getOccurrenceDetails(next);
      const s = epochOf(d.startDate, startTz);
      if (s >= to) break;
      push(s, epochOf(d.endDate, endTz));
    }
  }
  return out;
}

export const overlaps = (intervals, start, end) => intervals.some(([s, e]) => s < end && e > start);

// ---- iCal feed output ------------------------------------------------------

const esc = (s) =>
  String(s).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');

// RFC 5545: lines longer than 75 octets are folded with CRLF + space.
const fold = (line) => {
  const enc = new TextEncoder();
  if (enc.encode(line).length <= 75) return line;
  const out = [];
  let cur = '';
  let bytes = 0;
  for (const ch of line) {
    const b = enc.encode(ch).length;
    if (bytes + b > 75) {
      out.push(cur);
      cur = ' ';
      bytes = 1;
    }
    cur += ch;
    bytes += b;
  }
  out.push(cur);
  return out.join('\r\n');
};

const stamp = (ms) => new Date(ms).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');

// events: [{ uid, start (ms), end (ms), summary, description? }]
export function buildFeed({ name, events, now = new Date() }) {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Campus Cafe//Shifts//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${esc(name)}`,
    'REFRESH-INTERVAL;VALUE=DURATION:PT1H',
    'X-PUBLISHED-TTL:PT1H',
  ];
  for (const e of events) {
    lines.push(
      'BEGIN:VEVENT',
      `UID:${e.uid}`,
      `DTSTAMP:${stamp(now.getTime())}`,
      `DTSTART:${stamp(e.start)}`,
      `DTEND:${stamp(e.end)}`,
      `SUMMARY:${esc(e.summary)}`,
      ...(e.description ? [`DESCRIPTION:${esc(e.description)}`] : []),
      'TRANSP:OPAQUE',
      'STATUS:CONFIRMED',
      'END:VEVENT',
    );
  }
  lines.push('END:VCALENDAR');
  return lines.map(fold).join('\r\n') + '\r\n';
}
