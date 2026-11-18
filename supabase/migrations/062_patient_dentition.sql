-- Milk teeth (Gregor, 2026-11-13): which tooth each chart position shows, per
-- patient. The chart keeps its 32 positions; only the exceptions are stored,
-- keyed by the position's permanent FDI ('11'…'48'):
--   'deciduous'  the milk tooth is there (position 14 shows 54),
--   'unerupted'  the permanent tooth hasn't come through yet.
-- Empty = an adult. Chosen on a new patient's chart ("Zobovje: Mlečno"),
-- then changed tooth by tooth. Records stay under the tooth's own number (54
-- vs 14). Audited through the existing patients trigger. Additive.
begin;

alter table public.patients add column dentition jsonb not null default '{}'::jsonb;

-- Only position keys 11–48 (no 9/0 slots) with the two allowed values.
create or replace function public.valid_dentition(p jsonb)
returns boolean
language sql immutable
as $$
  select jsonb_typeof(p) = 'object'
     and not exists (
       select 1 from jsonb_each_text(p) e
        where e.key !~ '^[1-4][1-8]$' or e.value not in ('deciduous', 'unerupted')
           or (e.value = 'deciduous' and substr(e.key, 2, 1)::int > 5)
     )
$$;
alter table public.patients add constraint patients_dentition_valid check (public.valid_dentition(dentition));

commit;
