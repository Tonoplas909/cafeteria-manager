// Calendar sync. Members connect their private iCal link ("secret address in iCal
// format" in Google Calendar); this function reads it server-side and records which
// shifts they are busy for. The link is a secret: it is stored where only this
// function (service role) can read it, and never returned to the browser.
import ICAL from 'npm:ical.js@2.1.0';
import { createClient } from 'npm:@supabase/supabase-js@2';
import { buildFeed, busyIntervals, overlaps } from './core.js';
import { dateKey, occurrenceOn, parseDateKey, shiftOccurrence, todayIn } from './core.js';
import { localDayBounds } from './core.js';

const TZ = 'Europe/Paris';
const WINDOW_MS = 8 * 24 * 3600 * 1000;
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

  // Shifts this member is placed on, from today on (assignments are per date).
  const { data: mine } = await db
    .from('shift_assignments').select('shift_id, date').eq('staff_id', row.staff_id).gte('date', todayStr);
  const shiftIds = [...new Set((mine ?? []).map((m) => m.shift_id as number))];
  const { data: shifts } = shiftIds.length
    ? await db.from('shifts').select('id, day, time_label').in('id', shiftIds)
    : { data: [] as { id: number; day: string; time_label: string }[] };

  // Colleagues on the same shift and date, for the event description.
  const colleagues = new Map<string, string[]>();
  if (shiftIds.length) {
    const { data: all } = await db
      .from('shift_assignments').select('shift_id, date, staff_id').in('shift_id', shiftIds).gte('date', todayStr);
    const { data: people } = await db
      .from('staff').select('id, name').in('id', [...new Set((all ?? []).map((a) => a.staff_id as number))]);
    const nameOf = new Map((people ?? []).map((p) => [p.id as number, p.name as string]));
    for (const a of all ?? []) {
      if (a.staff_id === row.staff_id) continue;
      const k = `${a.shift_id}|${a.date}`;
      colleagues.set(k, [...(colleagues.get(k) ?? []), nameOf.get(a.staff_id) ?? '']);
    }
  }

  const events = [];
  for (const m of mine ?? []) {
    const s = (shifts ?? []).find((x) => x.id === m.shift_id);
    if (!s) continue;
    const occ = occurrenceOn(parseDateKey(m.date), s.time_label, TZ);
    if (!occ || occ.end <= now.getTime()) continue; // already over
    const others = (colleagues.get(`${m.shift_id}|${m.date}`) ?? []).filter(Boolean);
    const when = fr ? `Créneau du ${DAYS_FR[s.day] ?? s.day} ${s.time_label}.` : `${s.day} shift ${s.time_label}.`;
    const withText = others.length ? `\n${fr ? 'Avec' : 'With'} : ${others.join(', ')}` : '';
    events.push({
      uid: `shift-${s.id}-${String(m.date).replace(/-/g, '')}@campus-cafe`,
      start: occ.start,
      end: occ.end,
      summary: fr ? 'Service au Campus Café' : 'Campus Café shift',
      description: when + withText,
    });
  }

  return new Response(buildFeed({ name: 'Campus Café', events, now }), {
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
    const { data: shifts } = await db.from('shifts').select('id, day, time_label');
    const now = new Date();
    // Read events from midnight today so classes earlier today still count as "on campus".
    const from = localDayBounds(now.getTime(), TZ)[0];
    const occurrences = (shifts ?? [])
      .map((s) => ({ id: s.id as number, occ: shiftOccurrence(s.day, s.time_label, TZ, now) }))
      .filter((x) => x.occ);

    for (const staffId of staffIds) {
      const { data: cals } = await db.from('calendars').select('id').eq('staff_id', staffId);
      const ids = (cals ?? []).map((c) => c.id);
      if (!ids.length) {
        await db.from('shift_busy').delete().eq('staff_id', staffId);
        await db.from('shift_status').delete().eq('staff_id', staffId);
        continue;
      }
      const { data: secrets } = await db.from('calendar_secrets').select('calendar_id, ical_url').in('calendar_id', ids);
      try {
        const intervals: [number, number][] = [];
        for (const s of secrets ?? []) {
          intervals.push(...busyIntervals(ICAL, await fetchIcs(s.ical_url), from, now.getTime() + WINDOW_MS));
        }
        // Per shift: busy during it? and are there any events that day at all (on campus)?
        // Someone with no events all day is not "free": no point coming in just for the shift.
        const status = occurrences.map((x) => {
          const [dayStart, dayEnd] = localDayBounds(x.occ!.start, TZ);
          return {
            shift_id: x.id,
            staff_id: staffId,
            busy: overlaps(intervals, x.occ!.start, x.occ!.end),
            on_campus: overlaps(intervals, dayStart, dayEnd),
          };
        });
        await db.from('shift_status').delete().eq('staff_id', staffId);
        if (status.length) await db.from('shift_status').insert(status);
        // shift_busy is kept up to date for the previous version of the app.
        const busy = status.filter((x) => x.busy).map((x) => ({ shift_id: x.shift_id, staff_id: staffId }));
        await db.from('shift_busy').delete().eq('staff_id', staffId);
        if (busy.length) await db.from('shift_busy').insert(busy);
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
