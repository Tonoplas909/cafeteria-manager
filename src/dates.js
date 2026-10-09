// Dates of the schedule. Reuses the server's date logic so the page and the sync agree.
import { shiftDate as shiftDateIn, dateKey, parseDateKey, todayIn } from '../supabase/functions/calendar-sync/core.js';

export const TZ = 'Europe/Paris';
export { dateKey, parseDateKey };

// The date a weekly shift ("Monday"…) is shown for: today if it falls on that weekday, else the next one.
export const shiftDate = (dayName, now = new Date()) => shiftDateIn(dayName, TZ, now);

export const todayKey = (now = new Date()) => dateKey(todayIn(TZ, now));

// "vendredi 09 octobre 2026" / "Friday 09 October 2026", first letter capitalised.
export function formatDay(date, lang) {
  const text = new Date(Date.UTC(date.y, date.m - 1, date.d)).toLocaleDateString(lang === 'fr' ? 'fr-FR' : 'en-GB', {
    weekday: 'long',
    day: '2-digit',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
  return text.charAt(0).toUpperCase() + text.slice(1);
}
