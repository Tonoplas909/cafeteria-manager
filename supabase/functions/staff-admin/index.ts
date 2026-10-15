// Admin-only account management. Only a signed-in admin (per public.is_admin())
// can invite, re-send links to, or delete staff logins. Runs with the service
// role, which Supabase injects into the function environment — it never reaches
// the browser. Nobody (including the admin) ever sees a password: members get an
// emailed link and choose their own.
import { createClient } from 'npm:@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// Where an invitation or reset link may send people back to: the site itself (the SITE_URL secret,
// for example https://cafet.example.org/) and local development. Set it once per project with:
//   supabase secrets set SITE_URL=https://cafet.example.org/
const SITE_URL = (Deno.env.get('SITE_URL') ?? '').trim();
const withSlash = (u: string) => (u.endsWith('/') ? u : u + '/');
const ALLOWED_REDIRECTS = [...(SITE_URL ? [withSlash(SITE_URL)] : []), 'http://localhost:5173/'];
const safeRedirect = (v: unknown) =>
  typeof v === 'string' && ALLOWED_REDIRECTS.some((p) => v.startsWith(p)) ? v : ALLOWED_REDIRECTS[0];

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const url = Deno.env.get('SUPABASE_URL')!;
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;

  // Who is calling? Ask the database, using the caller's own token.
  const caller = createClient(url, anonKey, {
    global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
  });
  const { data: isAdmin, error: adminErr } = await caller.rpc('is_admin');
  if (adminErr || isAdmin !== true) return json({ error: 'Admins only' }, 403);
  const { data: callerId } = await caller.rpc('current_staff_id');

  const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  // Plain anon client: used to send "reset password" emails through the project's SMTP.
  const anon = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Invalid JSON' }, 400);
  }
  const redirectTo = safeRedirect(body.redirectTo);
  if ((body.action === 'create' || body.action === 'send-link') && !SITE_URL) {
    return json({ error: 'SITE_URL is not set on the server: run  supabase secrets set SITE_URL=https://your-site/' }, 500);
  }

  const findAuthUser = async (email: string) => {
    for (let page = 1; page <= 20; page++) {
      const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
      if (error) throw error;
      const hit = data.users.find((u) => u.email?.toLowerCase() === email);
      if (hit) return hit;
      if (data.users.length < 200) return null;
    }
    return null;
  };

  // Email a link: an invitation if they never confirmed, otherwise a password reset.
  const sendLink = async (email: string) => {
    const existing = await findAuthUser(email);
    if (!existing || !existing.email_confirmed_at) {
      return (await admin.auth.admin.inviteUserByEmail(email, { redirectTo })).error;
    }
    return (await anon.auth.resetPasswordForEmail(email, { redirectTo })).error;
  };

  try {
    const action = body.action;

    if (action === 'create') {
      const name = String(body.name ?? '').trim();
      const email = String(body.email ?? '').trim().toLowerCase();
      const role = body.role === 'admin' ? 'admin' : 'staff';
      if (!name || !EMAIL.test(email)) return json({ error: 'A name and a valid email are required' }, 400);

      const { data: row, error: insErr } = await admin
        .from('staff').insert({ name, email, role }).select('id').single();
      if (insErr) {
        return json({ error: insErr.code === '23505' ? 'That email is already on the staff list' : insErr.message }, 400);
      }

      const mailErr = await sendLink(email);
      if (mailErr) {
        await admin.from('staff').delete().eq('id', row.id);
        return json({ error: `Couldn't send the email: ${mailErr.message}` }, 400);
      }
      return json({ ok: true, id: row.id });
    }

    if (action === 'send-link') {
      const email = String(body.email ?? '').trim().toLowerCase();
      const { data: member } = await admin.from('staff').select('id').eq('email', email).maybeSingle();
      if (!member) return json({ error: 'Not on the staff list' }, 404);
      const mailErr = await sendLink(email);
      if (mailErr) return json({ error: `Couldn't send the email: ${mailErr.message}` }, 400);
      return json({ ok: true });
    }

    if (action === 'delete') {
      const id = Number(body.id);
      if (!Number.isInteger(id)) return json({ error: 'Invalid id' }, 400);
      if (id === callerId) return json({ error: "You can't remove your own account" }, 400);
      const { data: member } = await admin.from('staff').select('email').eq('id', id).maybeSingle();
      if (!member) return json({ error: 'Not found' }, 404);
      const { error: delErr } = await admin.from('staff').delete().eq('id', id);
      if (delErr) return json({ error: delErr.message }, 400);
      const existing = await findAuthUser(member.email.toLowerCase());
      if (existing) await admin.auth.admin.deleteUser(existing.id);
      return json({ ok: true });
    }

    return json({ error: 'Unknown action' }, 400);
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
