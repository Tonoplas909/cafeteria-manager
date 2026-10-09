-- Why someone is marked busy: how many minutes of the shift their calendar takes and the
-- time span of the event(s) involved (times only: event titles are never stored).
-- Shown in the "unavailable people" popup.
alter table public.shift_status
  add column if not exists overlap_minutes int not null default 0,
  add column if not exists busy_from timestamptz,
  add column if not exists busy_until timestamptz;
