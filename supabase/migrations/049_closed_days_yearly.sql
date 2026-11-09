-- "Ambulanta zaprta" dates can repeat every year (Gregor, 2026-11-09) — e.g.
-- 25. 12. – 26. 12. entered once instead of every year. A yearly entry
-- applies from its first date on, on the same day(s) of every later year; a
-- range may cross New Year (31. 12. – 2. 1.). Movable holidays (Easter
-- Monday) still need their own one-off date each year.
-- Additive: the new column defaults to false, so existing rows and older app
-- versions behave as before.
begin;

alter table public.practice_closed_days
  add column repeat_yearly boolean not null default false;
alter table public.practice_closed_days
  add constraint practice_closed_days_yearly_span
  check (not repeat_yearly or date_to < date_from + interval '1 year');

-- Is the clinic closed on this date (one-off or yearly entry)?
create or replace function public.practice_closed_on(p_practice_id uuid, p_date date)
returns boolean
language sql stable security definer set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.practice_closed_days c
    where c.practice_id = p_practice_id
      and (
        (not c.repeat_yearly and p_date between c.date_from and c.date_to)
        or (
          c.repeat_yearly and p_date >= c.date_from
          and case
            when to_char(c.date_from, 'MMDD') <= to_char(c.date_to, 'MMDD')
              then to_char(p_date, 'MMDD') between to_char(c.date_from, 'MMDD') and to_char(c.date_to, 'MMDD')
            else to_char(p_date, 'MMDD') >= to_char(c.date_from, 'MMDD')
              or to_char(p_date, 'MMDD') <= to_char(c.date_to, 'MMDD')
          end
        )
      )
  )
$$;
revoke all on function public.practice_closed_on(uuid, date) from public;

-- Same as 048, the closed-day test now via practice_closed_on().
create or replace function public.within_practice_hours(p_practice_id uuid, p_start timestamptz, p_end timestamptz)
returns boolean
language plpgsql stable security definer set search_path = public, pg_temp
as $$
declare
  ls timestamp := p_start at time zone 'Europe/Ljubljana';
  le timestamp := p_end at time zone 'Europe/Ljubljana';
begin
  if not exists (select 1 from public.practice_hours where practice_id = p_practice_id) then
    return true;
  end if;
  if ls::date <> (le - interval '1 microsecond')::date then
    return false; -- spans midnight
  end if;
  if public.practice_closed_on(p_practice_id, ls::date) then
    return false;
  end if;
  return exists (
    select 1 from public.practice_hours
    where practice_id = p_practice_id
      and weekday = extract(isodow from ls)
      and start_time <= ls::time
      and (case when le::time = time '00:00' then time '24:00' else le::time end) <= end_time
  );
end;
$$;

commit;
