-- Informed consents (soglasja k posegu) — Gregor, 2026-11-12.
--
--   consent_templates  the practice's library of consent forms (editable in
--                      Nastavitve → Soglasja). Every practice starts with six
--                      DRAFT texts written by Claude (needs_review = true) for
--                      the dentist to review before use.
--   patient_consents   one consent for one patient: a frozen copy of the text
--                      (title, body, plus the procedure details staff add,
--                      e.g. "zob 36"), signed by the patient with a drawn
--                      signature — on a tablet in the practice or through an
--                      emailed link (docs/patient-consent.html) — and confirmed
--                      by the dentist who explained it ("Pojasnil").
--
-- A signed consent never changes and can't be deleted; the dentist's
-- confirmation can still be added once afterwards. Signing, confirming and
-- cancelling go through functions so who/when can't be faked; a browser can
-- only create a consent (signature fields forced empty).
-- Additive for older app versions.
begin;

-- ---------------------------------------------------------------- Library
create table public.consent_templates (
  id uuid primary key default gen_random_uuid(),
  practice_id uuid not null references public.practices(id),
  title text not null check (length(trim(title)) between 1 and 160),
  -- Plain text like aftercare topics: blank line = paragraph, **bold** the
  -- only markup. Never HTML.
  body text not null default '' check (length(body) <= 30000),
  sort_order integer not null default 0,
  is_active boolean not null default true,
  needs_review boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index consent_templates_practice_id_idx on public.consent_templates(practice_id);
alter table public.consent_templates enable row level security;
create policy consent_templates_select on public.consent_templates for select
  using (practice_id = public.current_practice_id());
create policy consent_templates_insert on public.consent_templates for insert
  with check (practice_id = public.current_practice_id());
create policy consent_templates_update on public.consent_templates for update
  using (practice_id = public.current_practice_id())
  with check (practice_id = public.current_practice_id());
create policy consent_templates_delete on public.consent_templates for delete
  using (practice_id = public.current_practice_id());

-- ---------------------------------------------------------------- Consents
create table public.patient_consents (
  id uuid primary key default gen_random_uuid(),
  practice_id uuid not null references public.practices(id),
  patient_id uuid not null references public.patients(id) on delete cascade,
  template_id uuid references public.consent_templates(id) on delete set null,
  title text not null check (length(trim(title)) between 1 and 160),
  body text not null check (length(body) <= 30000),
  -- What exactly is planned, added by staff (e.g. "zob 36, implantat").
  details text check (details is null or length(details) <= 2000),
  -- The emailed link's credential (64 hex characters).
  token text not null unique default (replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '')),
  expires_at timestamptz not null default (now() + interval '30 days'),
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  created_by_name text,
  sent_at timestamptz,
  explained_at timestamptz,
  explained_by uuid references auth.users(id),
  explained_by_name text,
  signed_at timestamptz,
  signed_via text check (signed_via in ('tablet', 'link')),
  signer_name text check (signer_name is null or length(trim(signer_name)) between 2 and 120),
  -- The drawn signature as a PNG data URL.
  signature_png text check (signature_png is null or (signature_png like 'data:image/png;base64,%' and length(signature_png) <= 400000)),
  signer_user_agent text,
  cancelled_at timestamptz,
  check ((signed_at is null) = (signature_png is null))
);
create index patient_consents_patient_idx on public.patient_consents(patient_id, created_at desc);
create index patient_consents_practice_idx on public.patient_consents(practice_id);
alter table public.patient_consents enable row level security;
create policy patient_consents_select on public.patient_consents for select
  using (practice_id = public.current_practice_id());
create policy patient_consents_insert on public.patient_consents for insert
  with check (practice_id = public.current_practice_id());
-- No update/delete policies: the functions below are the only way to change one.

-- A new consent: practice from the patient, creator from the session, and
-- nothing pre-signed or pre-confirmed.
create or replace function public.prepare_patient_consent()
returns trigger
language plpgsql security definer set search_path = public, pg_temp
as $$
begin
  select practice_id into new.practice_id from public.patients where id = new.patient_id;
  new.created_by := auth.uid();
  new.created_by_name := public.current_user_display_name();
  new.created_at := now();
  new.sent_at := null;
  new.explained_at := null;
  new.explained_by := null;
  new.explained_by_name := null;
  new.signed_at := null;
  new.signed_via := null;
  new.signer_name := null;
  new.signature_png := null;
  new.signer_user_agent := null;
  new.cancelled_at := null;
  if new.template_id is not null
     and not exists (select 1 from public.consent_templates where id = new.template_id and practice_id = new.practice_id) then
    raise exception 'Predloga soglasja ne pripada tej ordinaciji.' using errcode = '42501';
  end if;
  return new;
end;
$$;
create trigger prepare_patient_consent_trigger
  before insert on public.patient_consents
  for each row execute function public.prepare_patient_consent();

-- Signed = frozen. Allowed afterwards: only the dentist's confirmation (once).
create or replace function public.guard_patient_consent()
returns trigger
language plpgsql set search_path = public, pg_temp
as $$
begin
  if tg_op = 'DELETE' then
    if old.signed_at is not null then
      raise exception 'Podpisanega soglasja ni mogoče izbrisati.' using errcode = '42501';
    end if;
    return old;
  end if;
  if old.signed_at is not null then
    if old.explained_at is null and new.explained_at is not null
       and (to_jsonb(new) - array['explained_at', 'explained_by', 'explained_by_name'])
           = (to_jsonb(old) - array['explained_at', 'explained_by', 'explained_by_name']) then
      return new;
    end if;
    raise exception 'Soglasje je podpisano in ga ni mogoče spreminjati.' using errcode = '42501';
  end if;
  if old.cancelled_at is not null then
    raise exception 'Soglasje je preklicano.' using errcode = '42501';
  end if;
  if old.explained_at is not null and new.explained_at is distinct from old.explained_at then
    raise exception 'Pojasnilo je že potrjeno.' using errcode = '42501';
  end if;
  -- The text itself never changes once created.
  if new.title is distinct from old.title or new.body is distinct from old.body
     or new.details is distinct from old.details or new.patient_id is distinct from old.patient_id
     or new.practice_id is distinct from old.practice_id or new.token is distinct from old.token then
    raise exception 'Besedila soglasja ni mogoče spreminjati.' using errcode = '42501';
  end if;
  return new;
end;
$$;
create trigger guard_patient_consent_trigger
  before update or delete on public.patient_consents
  for each row execute function public.guard_patient_consent();

-- The dentist confirms they explained the procedure.
create or replace function public.confirm_consent_explained(p_consent_id uuid)
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
  if v.explained_at is not null then return; end if;
  update public.patient_consents
     set explained_at = now(), explained_by = auth.uid(), explained_by_name = public.current_user_display_name()
   where id = p_consent_id;
end;
$$;
revoke all on function public.confirm_consent_explained(uuid) from public;
grant execute on function public.confirm_consent_explained(uuid) to authenticated;

-- Signing on the practice's tablet (the staff session is open on it).
create or replace function public.sign_consent_in_practice(p_consent_id uuid, p_signer_name text, p_signature_png text, p_user_agent text)
returns void
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v public.patient_consents%rowtype;
begin
  select * into v from public.patient_consents where id = p_consent_id for update;
  if not found or v.practice_id is distinct from public.current_practice_id() then
    raise exception 'Soglasja ni mogoče najti.' using errcode = '42501';
  end if;
  if v.signed_at is not null then raise exception 'Soglasje je že podpisano.' using errcode = '22023'; end if;
  if v.cancelled_at is not null then raise exception 'Soglasje je preklicano.' using errcode = '22023'; end if;
  update public.patient_consents
     set signed_at = now(), signed_via = 'tablet', signer_name = trim(p_signer_name),
         signature_png = p_signature_png, signer_user_agent = left(p_user_agent, 400)
   where id = p_consent_id;
end;
$$;
revoke all on function public.sign_consent_in_practice(uuid, text, text, text) from public;
grant execute on function public.sign_consent_in_practice(uuid, text, text, text) to authenticated;

-- Withdrawing an unsigned consent request (the link stops working).
create or replace function public.cancel_patient_consent(p_consent_id uuid)
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
  if v.signed_at is not null then raise exception 'Podpisanega soglasja ni mogoče preklicati.' using errcode = '22023'; end if;
  update public.patient_consents set cancelled_at = now() where id = p_consent_id and cancelled_at is null;
end;
$$;
revoke all on function public.cancel_patient_consent(uuid) from public;
grant execute on function public.cancel_patient_consent(uuid) to authenticated;

-- Audit log (056): consents are patient data; a patient signing one is
-- logged as a signature, like a signed visit.
create or replace function public.audit_row_change()
returns trigger
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_row jsonb := to_jsonb(case when tg_op = 'DELETE' then old else new end);
  v_old jsonb := case when tg_op = 'UPDATE' then to_jsonb(old) end;
  v_changed text[];
  v_patient uuid;
  v_action text := lower(tg_op);
begin
  if tg_table_name = 'visits' and tg_op = 'INSERT' then
    return null;  -- an empty visit being opened
  end if;
  if tg_op = 'UPDATE' then
    select array_agg(key order by key) into v_changed
      from jsonb_each(v_row) n
     where n.value is distinct from (v_old -> n.key);
    if v_changed is null then
      return null;  -- nothing actually changed
    end if;
    if tg_table_name = 'visits' and v_changed <@ array['closed_at'] then
      return null;  -- the visit being closed on leaving the record
    end if;
    -- Signing (a visit, or a patient's consent — 058) is its own action.
    if tg_table_name in ('visits', 'patient_consents') and (v_old ->> 'signed_at') is null and (v_row ->> 'signed_at') is not null then
      v_action := 'sign';
    end if;
  end if;

  v_patient := case tg_table_name
    when 'patients' then (v_row ->> 'id')::uuid
    when 'tooth_records' then (select patient_id from public.visits where id = (v_row ->> 'visit_id')::uuid)
    when 'visit_addenda' then (select patient_id from public.visits where id = (v_row ->> 'visit_id')::uuid)
    else (v_row ->> 'patient_id')::uuid
  end;
  if tg_table_name = 'visit_addenda' then v_action := 'addendum'; end if;

  insert into public.audit_log (practice_id, user_id, actor, action, entity, record_id, patient_id, details)
  values (
    (v_row ->> 'practice_id')::uuid,
    auth.uid(),
    public.audit_actor(),
    v_action,
    tg_table_name,
    v_row ->> 'id',
    v_patient,
    case
      when tg_table_name = 'tooth_records' then jsonb_build_object('tooth', v_row ->> 'tooth_id', 'fields', to_jsonb(v_changed))
      when v_changed is not null then jsonb_build_object('fields', to_jsonb(v_changed))
    end
  );
  return null;
end;
$$;

create trigger audit_patient_consents after insert or update or delete on public.patient_consents
  for each row execute function public.audit_row_change();

-- ---------------------------------------------------------------- Email
alter table public.email_log drop constraint if exists email_log_email_type_check;
alter table public.email_log add constraint email_log_email_type_check check (email_type in (
  'appointment_confirmation', 'appointment_reminder', 'appointment_cancelled', 'appointment_rescheduled',
  'post_visit', 'recall', 'health_questionnaire', 'invoice', 'aftercare', 'marketing_consent', 'patient_consent'
));

alter table public.email_templates drop constraint if exists email_templates_template_key_check;
alter table public.email_templates add constraint email_templates_template_key_check check (template_key in (
  'appointment_confirmation', 'appointment_reminder', 'appointment_cancelled', 'appointment_rescheduled',
  'post_visit', 'recall', 'health_questionnaire', 'invoice', 'credit_note', 'aftercare', 'patient_consent'
));

-- ---------------------------------------------------------------- Drafts
-- Six starter forms, DRAFTS written by Claude (general guidance, not legal
-- advice) — marked "Osnutek — preglejte" until the dentist saves them.
create or replace function public.seed_default_consent_templates(p_practice_id uuid)
returns void
language plpgsql security definer set search_path = public, pg_temp
as $$
begin
  if exists (select 1 from public.consent_templates where practice_id = p_practice_id) then
    return;
  end if;
  insert into public.consent_templates (practice_id, title, body, sort_order, needs_review) values
  (p_practice_id, 'Soglasje k vstavitvi zobnega implantata', $t$**Opis posega**
Zobni implantat je titanov vsadek, ki ga v lokalni anesteziji vstavimo v čeljustno kost in nadomesti korenino manjkajočega zoba. Po vgradnji implantat praviloma 2 do 6 mesecev vrašča v kost, nato nanj izdelamo protetično nadomestilo (krono, most ali protezo). Kadar kosti ni dovolj, je lahko potrebna tudi nadgradnja kosti ali dvig sinusa.

**Pričakovane koristi**
Nadomestitev manjkajočega zoba brez brušenja sosednjih zob, boljše žvečenje, govor in videz.

**Možna tveganja in zapleti**
Po posegu so pogosti oteklina, bolečina, modrica in rahla krvavitev, ki praviloma izzvenijo v nekaj dneh. Redkeje se pojavijo okužba, poškodba sosednjih zob, začasna ali izjemoma trajna okvara živca (mravljinčenje ali neobčutljivost ustnice, brade ali jezika), odprtje v čeljustno votlino ali neuspešno vraščanje implantata, zaradi česar ga je treba odstraniti. Tudi pri uspešno vraščenem implantatu lahko kasneje pride do vnetja tkiv okoli implantata (periimplantitis). Tveganje za zaplete povečujejo kajenje, slabo urejena sladkorna bolezen, nekatera zdravila (npr. zdravila za osteoporozo) in slaba ustna higiena.

**Druge možnosti zdravljenja**
Most, delna ali celotna snemna proteza ali opustitev nadomestitve zoba.

**Moje obveznosti**
Upošteval/a bom navodila po posegu, redno skrbel/a za ustno higieno in prihajal/a na kontrolne preglede.

**Izjava**
Zobozdravnik mi je razumljivo pojasnil potek posega, pričakovane koristi, možna tveganja in druge možnosti zdravljenja ter predvidene stroške. Imel/a sem možnost postavljati vprašanja in na vsa sem dobil/a odgovor. Seznanjen/a sem, da uspeha zdravljenja ni mogoče zagotoviti. S posegom prostovoljno soglašam in vem, da lahko soglasje kadarkoli pred posegom prekličem.$t$, 10, true),
  (p_practice_id, 'Soglasje k puljenju zoba', $t$**Opis posega**
Zob odstranimo v lokalni anesteziji. Kadar zoba ni mogoče izpuliti v celoti, je lahko potreben kirurški pristop (razrez dlesni, odstranitev dela kosti, razdelitev zoba) in šivanje rane. To velja predvsem za modrostne in zlomljene zobe.

**Pričakovane koristi**
Odstranitev vira bolečine ali okužbe oziroma priprava na nadaljnje zdravljenje.

**Možna tveganja in zapleti**
Po posegu so pogosti bolečina, oteklina, modrica, krvavitev in omejeno odpiranje ust, ki praviloma izzvenijo v nekaj dneh. Redkeje se pojavijo suha jamica (boleče vnetje jamice), okužba, zlom korenine, ki ostane v kosti, poškodba sosednjih zob ali zalivk, odprtje v čeljustno votlino pri zgornjih zobeh ter začasna ali izjemoma trajna okvara živca (mravljinčenje ali neobčutljivost ustnice, brade ali jezika), predvsem pri spodnjih modrostnih zobeh. Izjemoma redek zaplet je zlom čeljusti.

**Druge možnosti zdravljenja**
Ohranitveno zdravljenje zoba (npr. endodontsko zdravljenje), kadar je mogoče, ali opustitev posega z možnimi posledicami (bolečina, širjenje okužbe).

**Izjava**
Zobozdravnik mi je razumljivo pojasnil potek posega, pričakovane koristi, možna tveganja in druge možnosti zdravljenja. Imel/a sem možnost postavljati vprašanja in na vsa sem dobil/a odgovor. Upošteval/a bom navodila po posegu. S posegom prostovoljno soglašam in vem, da lahko soglasje kadarkoli pred posegom prekličem.$t$, 20, true),
  (p_practice_id, 'Soglasje k endodontskemu zdravljenju', $t$**Opis posega**
Pri endodontskem zdravljenju (zdravljenju koreninskih kanalov) v lokalni anesteziji odstranimo vneto ali odmrlo zobno pulpo, kanale očistimo, razkužimo in zapolnimo. Zdravljenje lahko poteka v več obiskih. Po zdravljenju zob praviloma potrebuje trajno restavracijo, pogosto krono.

**Pričakovane koristi**
Ohranitev zoba in odprava bolečine oziroma okužbe.

**Možna tveganja in zapleti**
Po posegu je lahko zob nekaj dni občutljiv. Redkeje se pojavijo zlom instrumenta v kanalu, predrtje stene korenine, zamašen ali zelo ukrivljen kanal, ki ga ni mogoče v celoti obdelati, poslabšanje vnetja (oteklina) ter kasnejši zlom oslabljenega zoba. Zdravljenje kljub pravilni izvedbi ni vedno uspešno; v tem primeru so lahko potrebni ponovno zdravljenje, kirurški poseg (resekcija korenine) ali odstranitev zoba.

**Druge možnosti zdravljenja**
Puljenje zoba in morebitna kasnejša nadomestitev (implantat, most, proteza) ali opustitev zdravljenja z možnimi posledicami (bolečina, širjenje okužbe).

**Izjava**
Zobozdravnik mi je razumljivo pojasnil potek zdravljenja, pričakovane koristi, možna tveganja in druge možnosti zdravljenja ter predvidene stroške. Imel/a sem možnost postavljati vprašanja in na vsa sem dobil/a odgovor. Z zdravljenjem prostovoljno soglašam in vem, da lahko soglasje kadarkoli prekličem.$t$, 30, true),
  (p_practice_id, 'Soglasje k oralnokirurškemu posegu', $t$**Opis posega**
Oralnokirurški poseg (npr. resekcija korenine, odstranitev ciste, nadgradnja kosti, dvig sinusa ali kirurška odstranitev zoba) opravimo v lokalni anesteziji. Poseg vključuje razrez dlesni, delo na kosti in šivanje rane. Natančen obseg posega je opisan spodaj.

**Pričakovane koristi**
Odprava vzroka težav oziroma priprava ustreznih pogojev za nadaljnje zdravljenje.

**Možna tveganja in zapleti**
Po posegu so pogosti bolečina, oteklina, modrica in krvavitev, ki praviloma izzvenijo v nekaj dneh. Redkeje se pojavijo okužba, slabše celjenje rane, poškodba sosednjih zob, odprtje v čeljustno votlino, neuspeh nadgradnje kosti ter začasna ali izjemoma trajna okvara živca (mravljinčenje ali neobčutljivost ustnice, brade ali jezika). Tveganje za zaplete povečujeta kajenje in slaba ustna higiena.

**Druge možnosti zdravljenja**
Zobozdravnik mi je predstavil druge možnosti, ki so v mojem primeru na voljo, in posledice opustitve posega.

**Izjava**
Zobozdravnik mi je razumljivo pojasnil potek posega, pričakovane koristi, možna tveganja in druge možnosti zdravljenja ter predvidene stroške. Imel/a sem možnost postavljati vprašanja in na vsa sem dobil/a odgovor. Upošteval/a bom navodila po posegu. S posegom prostovoljno soglašam in vem, da lahko soglasje kadarkoli pred posegom prekličem.$t$, 40, true),
  (p_practice_id, 'Soglasje k lokalni anesteziji', $t$**Opis posega**
Lokalno anestezijo (omrtvičenje) vbrizgamo v dlesen ali ob živec, da je poseg neboleč. Učinek traja praviloma 1 do 4 ure.

**Možna tveganja in zapleti**
Dokler omrtvičenje traja, se lahko ugriznete v ustnico, lice ali jezik — do takrat ne jejte in ne pijte vročega. Redkeje se pojavijo bolečina ali modrica na mestu vboda, pospešeno bitje srca, omotica ali slabost. Izjemoma redki so alergijska reakcija, okužba na mestu vboda in začasna ali izjemoma trajna okvara živca.

**Moje obveznosti**
Zobozdravnika sem obvestil/a o svojih boleznih, zdravilih, alergijah in morebitni nosečnosti.

**Izjava**
Zobozdravnik mi je razumljivo pojasnil namen in možna tveganja lokalne anestezije. Imel/a sem možnost postavljati vprašanja in na vsa sem dobil/a odgovor. Z lokalno anestezijo prostovoljno soglašam.$t$, 50, true),
  (p_practice_id, 'Soglasje k rentgenskemu slikanju med nosečnostjo', $t$**Opis posega**
Zobni rentgenski posnetek (intraoralni ali panoramski) je potreben za postavitev diagnoze oziroma varno zdravljenje. Odmerek sevanja pri zobnem slikanju je zelo majhen, žarek je usmerjen na zobe in čeljust, ne na trebuh. Za dodatno zaščito uporabimo zaščitni predpasnik.

**Pričakovane koristi**
Zanesljiva diagnoza in varnejše zdravljenje; brez posnetka bolezni ni vedno mogoče prepoznati ali pravilno zdraviti.

**Možna tveganja**
Po današnjem znanju je tveganje za plod pri zobnem rentgenskem slikanju zanemarljivo, vendar ga ni mogoče povsem izključiti. Slikanje opravimo le, kadar je za vaše zdravljenje potrebno, in ga ne odlagamo, če bi odlog ogrozil vaše zdravje.

**Druge možnosti**
Odložitev slikanja in zdravljenja po porodu, kadar to zdravstveno stanje dopušča.

**Izjava**
Zobozdravnik mi je razumljivo pojasnil, zakaj je posnetek potreben, ter možna tveganja in druge možnosti. Imela sem možnost postavljati vprašanja in na vsa sem dobila odgovor. S slikanjem prostovoljno soglašam.$t$, 60, true);
end;
$$;
revoke all on function public.seed_default_consent_templates(uuid) from public, anon, authenticated;

-- Existing practices get the drafts now; a new practice (or one that deleted
-- them all) adds them with "Dodaj osnutke" in Nastavitve → Soglasja.
do $$
declare
  p record;
begin
  for p in select id from public.practices loop
    perform public.seed_default_consent_templates(p.id);
  end loop;
end;
$$;

create or replace function public.add_default_consent_templates()
returns void
language plpgsql security definer set search_path = public, pg_temp
as $$
begin
  if public.current_practice_id() is null then
    raise exception 'Ordinacija ni najdena.' using errcode = '42501';
  end if;
  perform public.seed_default_consent_templates(public.current_practice_id());
end;
$$;
revoke all on function public.add_default_consent_templates() from public;
grant execute on function public.add_default_consent_templates() to authenticated;

commit;
