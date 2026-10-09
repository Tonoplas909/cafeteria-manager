-- Assignments belong to a DATE, not to "every Monday". The schedule shows the next
-- occurrence of each weekly shift (today if it falls on that weekday, otherwise the
-- next one), so on Thursday the Monday shown is next week's and starts out empty.

-- The date a weekly shift is shown for, in Paris time: today when the weekday matches
-- (even once the shift is over, until midnight), otherwise the next such day.
create or replace function public.next_shift_date(day_name text)
returns date
language sql stable set search_path = ''
as $$
  select t.today + (
    (
      case day_name
        when 'Sunday' then 0 when 'Monday' then 1 when 'Tuesday' then 2 when 'Wednesday' then 3
        when 'Thursday' then 4 when 'Friday' then 5 when 'Saturday' then 6
      end
      - extract(dow from t.today)::int + 7
    ) % 7
  )
  from (select (now() at time zone 'Europe/Paris')::date as today) t
$$;

alter table public.shift_assignments add column if not exists date date;

-- Existing assignments move to their shift's next date.
update public.shift_assignments sa
set date = public.next_shift_date(s.day)
from public.shifts s
where s.id = sa.shift_id and sa.date is null;

alter table public.shift_assignments alter column date set not null;
alter table public.shift_assignments drop constraint if exists shift_assignments_pkey;
alter table public.shift_assignments add primary key (shift_id, date, staff_id);
create index if not exists shift_assignments_staff_date on public.shift_assignments (staff_id, date);

-- Inserts that don't give a date (the previous version of the app) get the shift's
-- current date, so both versions keep working while the new one is rolled out.
create or replace function public.set_assignment_date()
returns trigger
language plpgsql set search_path = ''
as $$
begin
  if new.date is null then
    select public.next_shift_date(s.day) into new.date from public.shifts s where s.id = new.shift_id;
  end if;
  return new;
end
$$;

drop trigger if exists shift_assignments_date on public.shift_assignments;
create trigger shift_assignments_date
  before insert on public.shift_assignments
  for each row execute function public.set_assignment_date();
