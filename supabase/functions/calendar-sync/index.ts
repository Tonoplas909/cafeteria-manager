// Calendar sync. Members connect their private iCal link ("secret address in iCal
// format" in Google Calendar); this function reads it server-side and records which
// shifts they are busy for. The link is a secret: it is stored where only this
// function (service role) can read it, and never returned to the browser.
import ICAL from 'npm:ical.js@2.1.0';
import { createClient } from 'npm:@supabase/supabase-js@2';
import { buildFeed, busyIntervals, overlapDetails, overlaps } from './core.js';
import { dateKey, occurrenceOn, parseDateKey, servicesFrom, todayIn, HORIZON_DAYS } from './core.js';
import { localDayBounds } from './core.js';

const TZ = 'Europe/Paris';
// Calendars are read over the days the schedule shows, plus a day of margin.
const WINDOW_MS = (HORIZON_DAYS + 1) * 24 * 3600 * 1000;
const STALE_MS = 10 * 60 * 1000;
const MAX_ICS_CHARS = 5_000_000;

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

class UserError extends Error {}

// https only, and no loopback / private / internal hosts (this function fetches the URL server-side).
function safeUrl(raw: unknown): string {
  let url: URL;
  try {
    url = new URL(String(raw ?? '').trim().replace(/^webcal:/i, 'https:'));
  } catch {
    throw new UserError('That is not a valid link');
  }
  const h = url.hostname.toLowerCase();
  const privateHost =
    url.protocol !== 'https:' ||
    h === 'localhost' || h.endsWith('.local') || h.endsWith('.internal') ||
    h.startsWith('[') || /^\d{1,3}(\.\d{1,3}){3}$/.test(h) || !h.includes('.');
  if (privateHost) throw new UserError('The link must be an https calendar address');
  return url.toString();
}

async function fetchIcs(url: string): Promise<string> {
  const res = await fetch(url, { signal: AbortSignal.timeout(10_000), headers: { Accept: 'text/calendar' } });
  if (!res.ok) throw new UserError(`The calendar link answered with an error (${res.status})`);
  const text = await res.text();
  if (text.length > MAX_ICS_CHARS) throw new UserError('That calendar is too large');
  if (!/BEGIN:VCALENDAR/i.test(text)) throw new UserError("That link doesn't look like a calendar (iCal) feed");
  return text;
}

const adminClient = () =>
  createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

const newToken = () => {
  const b = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

const ISO_DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const DAYS_FR: Record<string, string> = {
  Monday: 'lundi', Tuesday: 'mardi', Wednesday: 'mercredi', Thursday: 'jeudi',
  Friday: 'vendredi', Saturday: 'samedi', Sunday: 'dimanche',
};

// GET ?t=<token>: a personal subscription feed with the member's next shifts.
// Google Calendar / Outlook / Apple fetch it without logging in, so the token is the secret.
async function serveFeed(req: Request) {
  const u = new URL(req.url);
  const token = u.searchParams.get('t') ?? '';
  const fr = u.searchParams.get('lang') !== 'en';
  const notFound = () => new Response('Not found', { status: 404, headers: cors });
  if (!/^[A-Za-z0-9_-]{20,}$/.test(token)) return notFound();

  const db = adminClient();
  const { data: row } = await db.from('feed_tokens').select('staff_id').eq('token', token).maybeSingle();
  if (!row) return notFound();

  const now = new Date();
  const todayStr = dateKey(todayIn(TZ, now));

  // Days this member is placed on, from today on. The service of each date is its
  // exception if it has one, else its weekday's usual hours.
  const { data: mine } = await db
    .from('service_assignments').select('date').eq('staff_id', row.staff_id).gte('date', todayStr).order('date');
  const dates = (mine ?? []).map((m) => m.date as string);
  const last = dates[dates.length - 1];
  const services = new Map<string, { time: string; weekday: number }>();
  const colleagues = new Map<string, string[]>();
  if (dates.length) {
    const [{ data: weekly }, { data: exceptions }, { data: all }] = await Promise.all([
      db.from('opening_hours').select('weekday, time_label, needed'),
      db.from('service_days').select('date, closed, time_label, needed').gte('date', todayStr).lte('date', last),
      db.from('service_assignments').select('date, staff_id').in('date', dates),
    ]);
    const span = Math.round((Date.parse(last) - Date.parse(todayStr)) / 86_400_000) + 1;
    for (const sv of servicesFrom(weekly ?? [], exceptions ?? [], parseDateKey(todayStr), span)) {
      if (!sv.closed) services.set(sv.key, { time: sv.time, weekday: sv.weekday });
    }
    // Colleagues on the same date, for the event description.
    const { data: people } = await db
      .from('staff').select('id, name').in('id', [...new Set((all ?? []).map((a) => a.staff_id as number))]);
    const nameOf = new Map((people ?? []).map((p) => [p.id as number, p.name as string]));
    for (const a of all ?? []) {
      if (a.staff_id === row.staff_id) continue;
      colleagues.set(a.date, [...(colleagues.get(a.date) ?? []), nameOf.get(a.staff_id) ?? '']);
    }
  }

  const events = [];
  for (const date of dates) {
    const sv = services.get(date);
    if (!sv) continue; // closed that day, or no hours any more
    const occ = occurrenceOn(parseDateKey(date), sv.time, TZ);
    if (!occ || occ.end <= now.getTime()) continue; // already over
    const others = (colleagues.get(date) ?? []).filter(Boolean);
    const dayName = ISO_DAYS[sv.weekday - 1];
    const when = fr ? `Créneau du ${DAYS_FR[dayName] ?? dayName} ${sv.time}.` : `${dayName} shift ${sv.time}.`;
    const withText = others.length ? `\n${fr ? 'Avec' : 'With'} : ${others.join(', ')}` : '';
    events.push({
      uid: `service-${date.replace(/-/g, '')}@campus-cafe`,
      start: occ.start,
      end: occ.end,
      summary: fr ? "Service à la Cafet'MIAGE" : "Cafet'MIAGE shift",
      description: when + withText,
    });
  }

  return new Response(buildFeed({ name: "Cafet'MIAGE", events, now }), {
    headers: {
      ...cors,
      'Content-Type': 'text/calendar; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method === 'GET') return serveFeed(req);
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const url = Deno.env.get('SUPABASE_URL')!;
  const caller = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
  });
  const { data: meId } = await caller.rpc('current_staff_id');
  if (!meId) return json({ error: 'Staff only' }, 403);
  const { data: isAdmin } = await caller.rpc('is_admin');

  const db = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Invalid JSON' }, 400);
  }

  // Recompute "busy" shifts for these members from all of their calendars.
  async function syncStaff(staffIds: number[]) {
    const failed: number[] = [];
    const now = new Date();
    // Read events from midnight today so classes earlier today still count as "on campus".
    const from = localDayBounds(now.getTime(), TZ)[0];
    // The services the schedule shows: one a day at most, identified by its date.
    const today = todayIn(TZ, now);
    const end = new Date(Date.UTC(today.y, today.m - 1, today.d + HORIZON_DAYS - 1));
    const [{ data: weekly }, { data: exceptions }] = await Promise.all([
      db.from('opening_hours').select('weekday, time_label, needed'),
      db.from('service_days').select('date, closed, time_label, needed')
        .gte('date', dateKey(today)).lte('date', end.toISOString().slice(0, 10)),
    ]);
    const occurrences = servicesFrom(weekly ?? [], exceptions ?? [], today, HORIZON_DAYS)
      .filter((sv) => !sv.closed)
      .map((sv) => ({ date: sv.key, occ: occurrenceOn(sv.date, sv.time, TZ) }))
      .filter((x) => x.occ);

    for (const staffId of staffIds) {
      const { data: cals } = await db.from('calendars').select('id').eq('staff_id', staffId);
      const ids = (cals ?? []).map((c) => c.id);
      if (!ids.length) {
        await db.from('service_status').delete().eq('staff_id', staffId);
        continue;
      }
      const { data: secrets } = await db.from('calendar_secrets').select('calendar_id, ical_url').in('calendar_id', ids);
      try {
        const intervals: [number, number][] = [];
        for (const s of secrets ?? []) {
          intervals.push(...busyIntervals(ICAL, await fetchIcs(s.ical_url), from, now.getTime() + WINDOW_MS));
        }
        // Per service: busy during it? and are there any events that day at all (on campus)?
        // Someone with no events all day is not "free": no point coming in just for the shift.
        const status = occurrences.map((x) => {
          const [dayStart, dayEnd] = localDayBounds(x.occ!.start, TZ);
          const d = overlapDetails(intervals, x.occ!.start, x.occ!.end);
          return {
            date: x.date,
            staff_id: staffId,
            busy: d.minutes > 0,
            on_campus: overlaps(intervals, dayStart, dayEnd),
            // why: minutes taken from the shift and the span of the event(s), never their titles
            overlap_minutes: d.minutes,
            busy_from: d.from === null ? null : new Date(d.from).toISOString(),
            busy_until: d.until === null ? null : new Date(d.until).toISOString(),
          };
        });
        await db.from('service_status').delete().eq('staff_id', staffId);
        if (status.length) await db.from('service_status').insert(status);
        await db.from('calendars').update({ last_sync: now.toISOString() }).in('id', ids);
      } catch {
        failed.push(staffId); // keep the previous result if a feed is unreachable
      }
    }
    return failed;
  }

  try {
    const action = body.action;

    if (action === 'connect') {
      const icsUrl = safeUrl(body.url);
      const text = await fetchIcs(icsUrl);
      try {
        busyIntervals(ICAL, text, Date.now(), Date.now() + 1000);
      } catch {
        throw new UserError("That link doesn't look like a calendar (iCal) feed");
      }
      const { data: me } = await db.from('staff').select('name').eq('id', meId).single();
      await db.from('calendars').delete().eq('staff_id', meId); // one calendar per member: replace
      const { data: cal, error } = await db
        .from('calendars').insert({ name: me!.name, staff_id: meId }).select('id').single();
      if (error) throw error;
      const { error: secErr } = await db.from('calendar_secrets').insert({ calendar_id: cal.id, ical_url: icsUrl });
      if (secErr) throw secErr;
      const failed = await syncStaff([meId]);
      if (failed.length) throw new UserError("Connected, but the first sync failed. Try “Sync now”.");
      return json({ ok: true });
    }

    if (action === 'disconnect') {
      const id = Number(body.id);
      const { data: cal } = await db.from('calendars').select('staff_id').eq('id', id).maybeSingle();
      if (!cal) return json({ error: 'Not found' }, 404);
      if (cal.staff_id !== meId && isAdmin !== true) return json({ error: 'Not allowed' }, 403);
      await db.from('calendars').delete().eq('id', id);
      if (cal.staff_id) await syncStaff([cal.staff_id]);
      return json({ ok: true });
    }

    if (action === 'feed-link' || action === 'feed-rotate') {
      const lang = body.lang === 'en' ? 'en' : 'fr';
      let token: string | undefined;
      if (action === 'feed-link') {
        const { data } = await db.from('feed_tokens').select('token').eq('staff_id', meId).maybeSingle();
        token = data?.token;
      }
      if (!token) {
        token = newToken();
        const { error } = await db.from('feed_tokens').upsert({ staff_id: meId, token });
        if (error) throw error;
      }
      return json({ url: `${url}/functions/v1/calendar-sync?t=${token}&lang=${lang}` });
    }

    if (action === 'sync') {
      const force = body.force === true;
      const { data: cals } = await db.from('calendars').select('staff_id, last_sync').not('staff_id', 'is', null);
      const cutoff = Date.now() - STALE_MS;
      const due = new Set<number>();
      for (const c of cals ?? []) {
        if (force ? (isAdmin === true || c.staff_id === meId) : !c.last_sync || new Date(c.last_sync).getTime() < cutoff) {
          due.add(c.staff_id);
        }
      }
      const failed = await syncStaff([...due]);
      return json({ ok: true, synced: due.size - failed.length, failed: failed.length });
    }

    return json({ error: 'Unknown action' }, 400);
  } catch (e) {
    if (e instanceof UserError) return json({ error: e.message }, 400);
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
