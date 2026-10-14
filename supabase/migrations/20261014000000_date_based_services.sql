-- Services belong to a DATE: at most one a day, and people sign up for a day.
--
--   opening_hours        the usual hours, one row per weekday (1 = Monday … 7 = Sunday)
--   service_days         exceptions for one date: closed, other hours, or another head count
--   service_assignments  who works on which date
--   service_status       calendar hints per date and member (written by calendar-sync)
--
-- The service of a date is its exception if there is one, otherwise its weekday's usual
-- hours. Changing the usual hours no longer rewrites past dates, a single date can be
-- closed or moved, and the schedule can show more than the next seven days.
--
-- Replaces shifts, shift_assignments, shift_status and shift_busy. Those are left in place
-- (unused) so this can be rolled back; a later migration drops them.

create table if not exists public.opening_hours (
  weekday    smallint primary key check (weekday between 1 and 7),
  time_label text not null,
  needed     int  not null default 2 check (needed > 0)
);

create table if not exists public.service_days (
  date       date primary key,
  closed     boolean not null default false,
  time_label text,                       -- null: the weekday's usual hours
  needed     int check (needed > 0)      -- null: the weekday's usual count
);

create table if not exists public.service_assignments (
  date     date   not null,
  staff_id bigint not null references public.staff(id) on delete cascade,
  primary key (date, staff_id)
);
create index if not exists service_assignments_staff on public.service_assignments (staff_id, date);

create table if not exists public.service_status (
  date            date    not null,
  staff_id        bigint  not null references public.staff(id) on delete cascade,
  busy            boolean not null default false,
  on_campus       boolean not null default false,
  overlap_minutes int     not null default 0,
  busy_from       timestamptz,
  busy_until      timestamptz,
  primary key (date, staff_id)
);

-- Access: same rules as before. Staff read everything; admins edit the hours;
-- staff add or remove only themselves on a day; calendar hints are written by the
-- calendar-sync function (service role) only.
alter table public.opening_hours       enable row level security;
alter table public.service_days        enable row level security;
alter table public.service_assignments enable row level security;
alter table public.service_status      enable row level security;
revoke all on public.opening_hours, public.service_days, public.service_assignments, public.service_status from anon;

drop policy if exists staff_read on public.opening_hours;
drop policy if exists admin_write on public.opening_hours;
create policy staff_read on public.opening_hours for select to authenticated using (public.is_staff());
create policy admin_write on public.opening_hours for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists staff_read on public.service_days;
drop policy if exists admin_write on public.service_days;
create policy staff_read on public.service_days for select to authenticated using (public.is_staff());
create policy admin_write on public.service_days for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists staff_read on public.service_assignments;
drop policy if exists self_or_admin_insert on public.service_assignments;
drop policy if exists self_or_admin_delete on public.service_assignments;
drop policy if exists admin_update on public.service_assignments;
create policy staff_read on public.service_assignments for select to authenticated using (public.is_staff());
create policy self_or_admin_insert on public.service_assignments for insert to authenticated
  with check (public.is_admin() or staff_id = public.current_staff_id());
create policy self_or_admin_delete on public.service_assignments for delete to authenticated
  using (public.is_admin() or staff_id = public.current_staff_id());
create policy admin_update on public.service_assignments for update to authenticated
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists staff_read on public.service_status;
create policy staff_read on public.service_status for select to authenticated using (public.is_staff());

-- ---- Move the existing data over -------------------------------------------------------

-- Usual hours: one per weekday. A weekday that had several shifts becomes one service
-- from the earliest start to the latest end, asking for the largest head count.
do $$
declare
  r record;
begin
  for r in
    select day, count(*) as n, string_agg(time_label, ', ' order by time_label) as labels
    from public.shifts group by day having count(*) > 1
  loop
    raise notice '% had % shifts (%): merged into one service', r.day, r.n, r.labels;
  end loop;
  for r in
    select day, time_label from public.shifts
    where time_label !~ '^\s*\d{1,2}:\d{2}\s*[–-]\s*\d{1,2}:\d{2}\s*$'
  loop
    raise warning '% shift "%" has no readable hours: not carried over, set its hours again', r.day, r.time_label;
  end loop;
end $$;

insert into public.opening_hours (weekday, time_label, needed)
select
  w.weekday,
  -- compared as times, not text, so 9:30 comes before 10:00
  to_char(min(substring(s.time_label from '^\s*(\d{1,2}:\d{2})')::time), 'HH24:MI') || '–' ||
    to_char(max(substring(s.time_label from '(\d{1,2}:\d{2})\s*$')::time), 'HH24:MI'),
  max(s.needed)
from public.shifts s
join (values ('Monday', 1), ('Tuesday', 2), ('Wednesday', 3), ('Thursday', 4),
             ('Friday', 5), ('Saturday', 6), ('Sunday', 7)) as w(day, weekday) on w.day = s.day
where s.time_label ~ '^\s*\d{1,2}:\d{2}\s*[–-]\s*\d{1,2}:\d{2}\s*$'
group by w.weekday
on conflict (weekday) do nothing;

-- Sign-ups keep their date; someone placed on two shifts of the same day is placed once.
insert into public.service_assignments (date, staff_id)
select distinct date, staff_id from public.shift_assignments
on conflict do nothing;

-- service_status is filled by the next calendar sync.
