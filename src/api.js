import { createClient } from '@supabase/supabase-js';
import { servicesFrom, HORIZON_DAYS, dateKey, parseDateKey, todayKey } from './dates.js';

export const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
);

const addDays = ({ y, m, d }, n) => {
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate() };
};

const check = ({ data, error }) => {
  if (error) throw error;
  return data;
};

// ISO order: index + 1 is the weekday number stored in opening_hours (1 = Monday).
export const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

// Reads every table and shapes it the way the screens expect.
export async function loadAll() {
  const today = todayKey();
  const last = dateKey(addDays(parseDateKey(today), HORIZON_DAYS - 1));
  const [staff, products, weekly, exceptions, assignments, status, calendars] = await Promise.all([
    supabase.from('staff').select('*').order('id').then(check),
    supabase.from('products').select('*').order('id').then(check),
    supabase.from('opening_hours').select('*').order('weekday').then(check),
    supabase.from('service_days').select('*').gte('date', today).lte('date', last).then(check),
    supabase.from('service_assignments').select('*').gte('date', today).lte('date', last).then(check),
    supabase.from('service_status').select('*').gte('date', today).lte('date', last).then(check),
    supabase.from('calendars').select('id, name, last_sync, staff_id').order('id').then(check),
  ]);

  const withCalendar = new Set(calendars.map((c) => c.staff_id));
  // One service a day at most, identified by its date: the usual hours of its weekday,
  // unless that date has an exception. Placements belong to the date.
  const days = servicesFrom(weekly, exceptions, parseDateKey(today), HORIZON_DAYS).map((s) => {
    const rows = status.filter((r) => r.date === s.key);
    const service = s.closed
      ? null
      : {
          time: s.time,
          needed: s.needed,
          assigned: assignments.filter((a) => a.date === s.key).map((a) => a.staff_id),
          busy: rows.filter((r) => r.busy).map((r) => r.staff_id),
          noClass: rows.filter((r) => !r.on_campus).map((r) => r.staff_id),
          status: rows, // raw rows, for the "unavailable people" popup
        };
    // Purely indicative hints, never a rule. "Free" = has a synced calendar, has at least one
    // event that day (so is on campus anyway) and isn't busy during the service.
    // Someone with no events all day isn't listed as free: no point coming in just for a shift.
    const synced = (m) => withCalendar.has(m.id) && rows.some((r) => r.staff_id === m.id);
    return {
      key: s.key,
      date: s.date,
      weekday: s.weekday,
      isToday: s.key === today,
      closed: s.closed,
      exception: s.exception,
      service,
      hasCalendars: withCalendar.size > 0,
      free: service
        ? staff.filter((m) => synced(m) && !service.noClass.includes(m.id) && !service.busy.includes(m.id)).map((m) => m.name)
        : [],
      noClass: service ? staff.filter((m) => synced(m) && service.noClass.includes(m.id)).map((m) => m.name) : [],
    };
  });

  return {
    staff,
    days,
    weekly,
    exceptions,
    inventory: products.map((p) => ({
      id: p.id,
      name: p.name,
      current: p.current,
      minLevel: p.min_level,
      targetLevel: p.target_level,
      weeklyUsage: p.weekly_usage,
      cost: p.cost,
      price: p.price,
      category: p.category,
      externalId: p.external_id,
    })),
    calendars: calendars.map((c) => ({ id: c.id, name: c.name, staffId: c.staff_id, lastSync: c.last_sync })),
  };
}

// Edge functions: account management and calendar sync run server-side.
async function invoke(fn, body) {
  const { data, error } = await supabase.functions.invoke(fn, { body });
  if (error) {
    let msg = error.message;
    try { msg = (await error.context.json()).error || msg; } catch { /* keep default */ }
    throw new Error(msg);
  }
  return data;
}
const redirectTo = () => window.location.origin + window.location.pathname;

export const api = {
  // staff (admin only)
  createStaff: (m) => invoke('staff-admin', { action: 'create', redirectTo: redirectTo(), ...m }),
  sendLink: (email) => invoke('staff-admin', { action: 'send-link', email, redirectTo: redirectTo() }),
  deleteStaff: (id) => invoke('staff-admin', { action: 'delete', id }),
  toggleRole: (id, role) => supabase.from('staff').update({ role }).eq('id', id).then(check),

  // products
  addProduct: (p) => supabase.from('products').insert(p).then(check),
  removeProduct: (id) => supabase.from('products').delete().eq('id', id).then(check),
  // Applies a plan from importStock.js: updates stock/price of known products, adds the rest.
  async importProducts({ updates, creates }) {
    await Promise.all(
      updates.map((u) =>
        supabase
          .from('products')
          .update({
            current: u.current,
            ...(u.price != null && { price: u.price }),
            ...(u.category && { category: u.category }),
            ...(u.externalId && { external_id: u.externalId }),
          })
          .eq('id', u.id)
          .then(check),
      ),
    );
    if (creates.length) {
      check(
        await supabase.from('products').insert(
          creates.map((c) => ({
            name: c.name,
            current: c.current,
            price: c.price ?? 0,
            category: c.category,
            external_id: c.externalId,
          })),
        ),
      );
    }
  },
  adjustStock: (id, current, targetLevel) =>
    supabase
      .from('products')
      .update({ current, ...(targetLevel !== undefined && { target_level: targetLevel }) })
      .eq('id', id)
      .then(check),
  // targets: [{ id, targetLevel }], targetLevel null clears the target.
  setTargets: (targets) =>
    Promise.all(
      targets.map((t) => supabase.from('products').update({ target_level: t.targetLevel }).eq('id', t.id).then(check)),
    ),

  // services: usual hours per weekday, exceptions per date, sign-ups per date
  // rows: [{ weekday, time_label, needed }] for open weekdays; the others are closed.
  async setOpeningHours(rows) {
    const open = rows.map((r) => r.weekday);
    if (open.length) check(await supabase.from('opening_hours').upsert(rows));
    const closed = [1, 2, 3, 4, 5, 6, 7].filter((d) => !open.includes(d));
    if (closed.length) check(await supabase.from('opening_hours').delete().in('weekday', closed));
  },
  // { closed, time_label, needed } for one date; null time or count keep the usual ones.
  setServiceDay: (date, day) => supabase.from('service_days').upsert({ date, ...day }).then(check),
  clearServiceDay: (date) => supabase.from('service_days').delete().eq('date', date).then(check),
  async assignService(date, staffIds) {
    check(await supabase.from('service_assignments').delete().eq('date', date));
    if (staffIds.length) {
      check(await supabase.from('service_assignments').insert(staffIds.map((staff_id) => ({ date, staff_id }))));
    }
  },
  joinService: (date, staffId) => supabase.from('service_assignments').insert({ date, staff_id: staffId }).then(check),
  leaveService: (date, staffId) =>
    supabase.from('service_assignments').delete().eq('date', date).eq('staff_id', staffId).then(check),

  // calendars
  connectCalendar: (url) => invoke('calendar-sync', { action: 'connect', url }),
  disconnectCalendar: (id) => invoke('calendar-sync', { action: 'disconnect', id }),
  syncCalendars: (force = false) => invoke('calendar-sync', { action: 'sync', force }),
  // Personal subscription link for "my shifts in my calendar".
  feedLink: (lang) => invoke('calendar-sync', { action: 'feed-link', lang }).then((r) => r.url),
  rotateFeedLink: (lang) => invoke('calendar-sync', { action: 'feed-rotate', lang }).then((r) => r.url),

  // account
  changePassword: async (password) => {
    const { error } = await supabase.auth.updateUser({ password });
    if (error) throw error;
  },
};

export const auth = {
  signOut: () => supabase.auth.signOut(),
};
