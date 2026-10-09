// Run with: npm test
// The edge function runs in UTC, and the timezone bugs only show there, so force it.
process.env.TZ = 'UTC';

import test from 'node:test';
import assert from 'node:assert/strict';
import ICAL from 'ical.js';
import { busyIntervals, localDayBounds, nextOccurrence, overlaps } from './core.js';

const TZ = 'Europe/Paris';
const iso = (ms) => new Date(ms).toISOString();

const cal = (body, head = '') => `BEGIN:VCALENDAR\nVERSION:2.0\nPRODID:-//test//EN\n${head}${body}END:VCALENDAR`;
const event = (uid, start, end, extra = '') =>
  `BEGIN:VEVENT\nUID:${uid}\nDTSTART${start}\nDTEND${end}\n${extra}END:VEVENT\n`;
const paris = (uid, startLocal, endLocal, extra) =>
  event(uid, `;TZID=Europe/Paris:${startLocal}`, `;TZID=Europe/Paris:${endLocal}`, extra);

const VTIMEZONE = `BEGIN:VTIMEZONE
TZID:Europe/Paris
BEGIN:STANDARD
DTSTART:19701025T030000
RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU
TZOFFSETFROM:+0200
TZOFFSETTO:+0100
END:STANDARD
BEGIN:DAYLIGHT
DTSTART:19700329T020000
RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU
TZOFFSETFROM:+0100
TZOFFSETTO:+0200
END:DAYLIGHT
END:VTIMEZONE
`;

// Fri 9 Oct 2026, 11:00 Paris. The next Thursday shift is Thu 15 Oct, 12:15-13:45 Paris.
const NOW = new Date('2026-10-09T09:00:00Z');
const WINDOW = [localDayBounds(NOW.getTime(), TZ)[0], NOW.getTime() + 8 * 864e5];
const thursdayShift = nextOccurrence('Thursday', '12:15–13:45', TZ, NOW);
const busyDuringShift = (ics) => overlaps(busyIntervals(ICAL, ics, ...WINDOW), thursdayShift.start, thursdayShift.end);

test('shift is 12:15-13:45 Paris time', () => {
  assert.equal(iso(thursdayShift.start), '2026-10-15T10:15:00.000Z');
  assert.equal(iso(thursdayShift.end), '2026-10-15T11:45:00.000Z');
});

for (const [label, head, zone] of [
  ['timezone defined in the file', VTIMEZONE, 'Europe/Paris'],
  ['TZID with no VTIMEZONE in the file', '', 'Europe/Paris'],
  ['Windows-style TZID with no VTIMEZONE', '', 'W. Europe Standard Time'],
]) {
  test(`classes ending at 12:15 and resuming at 13:45 leave the shift free (${label})`, () => {
    const ics = cal(
      event('am', `;TZID=${zone}:20261015T080000`, `;TZID=${zone}:20261015T121500`) +
        event('pm', `;TZID=${zone}:20261015T134500`, `;TZID=${zone}:20261015T170000`),
      head,
    );
    assert.equal(busyDuringShift(ics), false);
  });
}

test('one minute of overlap on either side is busy', () => {
  assert.equal(busyDuringShift(cal(paris('a', '20261015T080000', '20261015T121600'))), true);
  assert.equal(busyDuringShift(cal(paris('b', '20261015T134400', '20261015T170000'))), true);
});

test('UTC (Z) and floating times are read correctly', () => {
  // 08:00-12:15 Paris = 06:00-10:15Z; floating times are taken as Paris time
  assert.equal(busyDuringShift(cal(event('z', ':20261015T060000Z', ':20261015T101500Z'))), false);
  assert.equal(busyDuringShift(cal(event('z2', ':20261015T060000Z', ':20261015T101600Z'))), true);
  assert.equal(busyDuringShift(cal(event('f', ':20261015T080000', ':20261015T121500'))), false);
  assert.equal(busyDuringShift(cal(event('f2', ':20261015T120000', ':20261015T130000'))), true);
});

test('weekly events keep their wall-clock time across the end of summer time', () => {
  const ics = cal(paris('w', '20261008T100000', '20261008T121500', 'RRULE:FREQ=WEEKLY;BYDAY=TH\n'));
  const starts = busyIntervals(ICAL, ics, Date.parse('2026-10-01T00:00:00Z'), Date.parse('2026-11-06T00:00:00Z')).map(
    ([s]) => iso(s),
  );
  assert.ok(starts.includes('2026-10-08T08:00:00.000Z'), 'summer time: 10:00 Paris = 08:00Z');
  assert.ok(starts.includes('2026-10-29T09:00:00.000Z'), 'winter time: 10:00 Paris = 09:00Z');
});

test('all-day, cancelled and transparent events are ignored', () => {
  assert.equal(busyDuringShift(cal('BEGIN:VEVENT\nUID:d\nDTSTART;VALUE=DATE:20261015\nDTEND;VALUE=DATE:20261016\nEND:VEVENT\n')), false);
  assert.equal(busyDuringShift(cal(paris('c', '20261015T120000', '20261015T130000', 'STATUS:CANCELLED\n'))), false);
  assert.equal(busyDuringShift(cal(paris('t', '20261015T120000', '20261015T130000', 'TRANSP:TRANSPARENT\n'))), false);
});

test('day bounds are Paris midnight to Paris midnight', () => {
  const [s, e] = localDayBounds(thursdayShift.start, TZ);
  assert.equal(iso(s), '2026-10-14T22:00:00.000Z');
  assert.equal(iso(e), '2026-10-15T22:00:00.000Z');
});

test('a class earlier today still counts for today\'s shift', () => {
  const fridayShift = nextOccurrence('Friday', '12:15–13:45', TZ, NOW);
  const [dayStart, dayEnd] = localDayBounds(fridayShift.start, TZ);
  const intervals = busyIntervals(ICAL, cal(paris('m', '20261009T090000', '20261009T100000')), ...WINDOW);
  assert.equal(overlaps(intervals, dayStart, dayEnd), true);
});
