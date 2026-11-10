-- Appointment durations offered in the booking windows (Koledar, patient
-- record), set per clinic in Nastavitve → Delovni čas (Gregor, 2026-11-10).
-- Null = the app's defaults (15, 30, 45, 60, 90, 120, 180 min). Owners write
-- through practice_settings' existing policies.
-- Additive: older app versions ignore the column.
begin;

alter table public.practice_settings
  add column appointment_durations smallint[]
  check (
    appointment_durations is null
    or (
      cardinality(appointment_durations) between 1 and 20
      and 5 <= all (appointment_durations)
      and 480 >= all (appointment_durations)
    )
  );

commit;
