-- Signing devices for informed consents (Gregor, 2026-11-12): a practice
-- tablet (or any phone/tablet) paired once with a code, then sitting on the
-- page docs/podpis.html waiting for a consent sent to it from any computer in
-- the practice ("Pošlji na tablico za podpis").
--
-- The device is NOT logged into the app: it holds only a device secret (the
-- database keeps its SHA-256 hash) and through the signing-device function it
-- can only fetch the consent currently sent to it — a patient holding it can't
-- reach any record. Pairing codes are 8 characters (no look-alike letters), valid 15 minutes,
-- used once — too many combinations to guess.
--
-- patient_consents.signed_via gains 'device'. Additive.
begin;

create table public.signing_devices (
  id uuid primary key default gen_random_uuid(),
  practice_id uuid not null references public.practices(id),
  name text not null check (length(trim(name)) between 1 and 60),
  secret_hash text unique,
  pairing_code text,
  pairing_expires_at timestamptz,
  paired_at timestamptz,
  last_seen_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);
create index signing_devices_practice_idx on public.signing_devices(practice_id);
create unique index signing_devices_pairing_code_idx on public.signing_devices(pairing_code) where pairing_code is not null;
alter table public.signing_devices enable row level security;
create policy signing_devices_select on public.signing_devices for select
  using (practice_id = public.current_practice_id());
-- Writes only through the functions below (and the signing-device function).

-- 8 characters from an alphabet without look-alikes (0/O, 1/I/L): ~10^12 codes.
create or replace function public.new_pairing_code()
returns text
language sql volatile set search_path = public, pg_temp
as $$
  -- Bytes from gen_random_uuid() (a cryptographic generator); a v4 UUID's
  -- bytes 6 and 8 carry fixed bits, so only 0-5 and 10-11 are used.
  select string_agg(substr('23456789ABCDEFGHJKMNPQRSTUVWXYZ', 1 + (get_byte(b, i) % 31), 1), '' order by i)
    from (select decode(replace(gen_random_uuid()::text, '-', ''), 'hex') as b) u,
         unnest(array[0, 1, 2, 3, 4, 5, 10, 11]) as i
$$;
revoke all on function public.new_pairing_code() from public;

-- A new device with a fresh pairing code; returns the code.
create or replace function public.create_signing_device(p_name text)
returns text
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_code text;
begin
  if public.current_practice_id() is null then
    raise exception 'Ordinacija ni najdena.' using errcode = '42501';
  end if;
  loop
    v_code := public.new_pairing_code();
    exit when not exists (select 1 from public.signing_devices where pairing_code = v_code);
  end loop;
  insert into public.signing_devices (practice_id, name, pairing_code, pairing_expires_at)
  values (public.current_practice_id(), trim(p_name), v_code, now() + interval '15 minutes');
  return v_code;
end;
$$;
revoke all on function public.create_signing_device(text) from public;
grant execute on function public.create_signing_device(text) to authenticated;

-- A new pairing code for an existing device (re-pairing replaces its secret).
create or replace function public.renew_signing_device_code(p_device_id uuid)
returns text
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_code text;
begin
  if not exists (select 1 from public.signing_devices where id = p_device_id and practice_id = public.current_practice_id()) then
    raise exception 'Naprave ni mogoče najti.' using errcode = '42501';
  end if;
  loop
    v_code := public.new_pairing_code();
    exit when not exists (select 1 from public.signing_devices where pairing_code = v_code);
  end loop;
  update public.signing_devices
     set pairing_code = v_code, pairing_expires_at = now() + interval '15 minutes', revoked_at = null
   where id = p_device_id;
  return v_code;
end;
$$;
revoke all on function public.renew_signing_device_code(uuid) from public;
grant execute on function public.renew_signing_device_code(uuid) to authenticated;

create or replace function public.revoke_signing_device(p_device_id uuid)
returns void
language plpgsql security definer set search_path = public, pg_temp
as $$
begin
  update public.signing_devices
     set revoked_at = now(), secret_hash = null, pairing_code = null
   where id = p_device_id and practice_id = public.current_practice_id();
end;
$$;
revoke all on function public.revoke_signing_device(uuid) from public;
grant execute on function public.revoke_signing_device(uuid) to authenticated;

-- ---------------------------------------------------------------- Consents
alter table public.patient_consents
  add column device_id uuid references public.signing_devices(id) on delete set null,
  add column device_requested_at timestamptz;
alter table public.patient_consents drop constraint if exists patient_consents_signed_via_check;
alter table public.patient_consents add constraint patient_consents_signed_via_check
  check (signed_via in ('tablet', 'link', 'device'));

-- Sends an unsigned consent to a paired device of the same practice (or, with
-- null, takes it back). The device shows it for 30 minutes.
create or replace function public.send_consent_to_device(p_consent_id uuid, p_device_id uuid)
returns void
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v public.patient_consents%rowtype;
begin
  select * into v from public.patient_consents where id = p_consent_id;
  if not found or v.practice_id is distinct from public.current_practice_id() then
    raise exception 'Soglasja ni mogoče najti.' using errcode = '42501';
  end if;
  if v.signed_at is not null then raise exception 'Soglasje je že podpisano.' using errcode = '22023'; end if;
  if v.cancelled_at is not null then raise exception 'Soglasje je preklicano.' using errcode = '22023'; end if;
  if p_device_id is not null and not exists (
    select 1 from public.signing_devices
     where id = p_device_id and practice_id = v.practice_id and paired_at is not null and revoked_at is null
  ) then
    raise exception 'Naprava ni povezana.' using errcode = '22023';
  end if;
  -- Only one consent at a time on a device.
  if p_device_id is not null then
    update public.patient_consents set device_id = null, device_requested_at = null
     where device_id = p_device_id and id <> p_consent_id and signed_at is null and cancelled_at is null;
  end if;
  update public.patient_consents
     set device_id = p_device_id,
         device_requested_at = case when p_device_id is null then null else now() end,
         -- Signing on site keeps the link alive for the session.
         expires_at = greatest(expires_at, now() + interval '1 day')
   where id = p_consent_id;
end;
$$;
revoke all on function public.send_consent_to_device(uuid, uuid) from public;
grant execute on function public.send_consent_to_device(uuid, uuid) to authenticated;

-- QR code on the screen: make sure the link works for the next day.
create or replace function public.prepare_consent_link(p_consent_id uuid)
returns text
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v public.patient_consents%rowtype;
begin
  select * into v from public.patient_consents where id = p_consent_id;
  if not found or v.practice_id is distinct from public.current_practice_id() then
    raise exception 'Soglasja ni mogoče najti.' using errcode = '42501';
  end if;
  if v.signed_at is not null then raise exception 'Soglasje je že podpisano.' using errcode = '22023'; end if;
  if v.cancelled_at is not null then raise exception 'Soglasje je preklicano.' using errcode = '22023'; end if;
  update public.patient_consents set expires_at = greatest(expires_at, now() + interval '1 day') where id = p_consent_id;
  return v.token;
end;
$$;
revoke all on function public.prepare_consent_link(uuid) from public;
grant execute on function public.prepare_consent_link(uuid) to authenticated;

commit;
