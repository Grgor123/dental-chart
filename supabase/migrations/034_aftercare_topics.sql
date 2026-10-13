-- Aftercare instructions ("Navodila po posegu"), sent with the invoice.
-- Agreed design (CLAUDE.md → "Email templates (E-pošta)" → "Planned next",
-- item 1): a practice keeps a library of topics (named instruction texts);
-- each topic is ticked automatically by price-list categories; the invoice
-- draft shows the topics pre-ticked from its lines' categories; issuing the
-- invoice emails the ticked topics to the patient in one email.
--   - aftercare_topics: the library (root table — the client sets
--     practice_id). Every practice starts with five topics whose texts are
--     DRAFTS (needs_review = true) for the dentist to review.
--   - aftercare_topic_categories: which categories tick which topic
--     (many-to-many).
--   - invoices.aftercare_topic_ids: the draft's ticked topics. null = "follow
--     the categories" (nothing chosen by hand yet); frozen once issued, like
--     every other invoice column (guard_invoice).
--   - email_log type 'aftercare' and email template key 'aftercare' (the
--     email's editable intro).
begin;

-- ---- Topics ------------------------------------------------------------------
create table public.aftercare_topics (
  id uuid primary key default gen_random_uuid(),
  practice_id uuid not null references public.practices(id),
  title text not null check (length(trim(title)) between 1 and 120),
  -- Plain text like the email templates: blank line = new paragraph, single
  -- line break kept, **bold** the only markup. Never HTML.
  body text not null default '',
  sort_order integer not null default 0,
  is_active boolean not null default true,
  -- A starter text nobody has reviewed yet (cleared on the first save).
  needs_review boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index aftercare_topics_practice_id_idx on public.aftercare_topics(practice_id);

alter table public.aftercare_topics enable row level security;
create policy aftercare_topics_select on public.aftercare_topics for select
  using (practice_id = public.current_practice_id());
create policy aftercare_topics_insert on public.aftercare_topics for insert
  with check (practice_id = public.current_practice_id());
create policy aftercare_topics_update on public.aftercare_topics for update
  using (practice_id = public.current_practice_id())
  with check (practice_id = public.current_practice_id());
create policy aftercare_topics_delete on public.aftercare_topics for delete
  using (practice_id = public.current_practice_id());

-- ---- Topic ↔ category ----------------------------------------------------------
create table public.aftercare_topic_categories (
  practice_id uuid not null references public.practices(id),
  topic_id uuid not null references public.aftercare_topics(id) on delete cascade,
  category_id uuid not null references public.service_categories(id) on delete cascade,
  primary key (topic_id, category_id)
);
create index aftercare_topic_categories_category_id_idx on public.aftercare_topic_categories(category_id);

-- Topic and category must both belong to the row's practice (the FKs alone
-- accept a guessed id from another practice).
create or replace function public.check_aftercare_topic_category()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not exists (select 1 from public.aftercare_topics t where t.id = new.topic_id and t.practice_id = new.practice_id)
     or not exists (select 1 from public.service_categories c where c.id = new.category_id and c.practice_id = new.practice_id) then
    raise exception 'topic or category does not belong to this practice';
  end if;
  return new;
end;
$$;
create trigger check_aftercare_topic_category_trigger
  before insert or update on public.aftercare_topic_categories
  for each row execute function public.check_aftercare_topic_category();

alter table public.aftercare_topic_categories enable row level security;
create policy aftercare_topic_categories_select on public.aftercare_topic_categories for select
  using (practice_id = public.current_practice_id());
create policy aftercare_topic_categories_insert on public.aftercare_topic_categories for insert
  with check (practice_id = public.current_practice_id());
create policy aftercare_topic_categories_delete on public.aftercare_topic_categories for delete
  using (practice_id = public.current_practice_id());

-- ---- Invoice, email log, template key ----------------------------------------
alter table public.invoices add column aftercare_topic_ids uuid[];

alter table public.email_log drop constraint if exists email_log_email_type_check;
alter table public.email_log add constraint email_log_email_type_check check (email_type in (
  'appointment_confirmation',
  'appointment_reminder',
  'appointment_cancelled',
  'appointment_rescheduled',
  'post_visit',
  'recall',
  'health_questionnaire',
  'invoice',
  'aftercare'
));

alter table public.email_templates drop constraint if exists email_templates_template_key_check;
alter table public.email_templates add constraint email_templates_template_key_check check (template_key in (
  'appointment_confirmation',
  'appointment_reminder',
  'appointment_cancelled',
  'appointment_rescheduled',
  'post_visit',
  'recall',
  'health_questionnaire',
  'invoice',
  'credit_note',
  'aftercare'
));

-- ---- Starter topics ---------------------------------------------------------------
-- Five topics with DRAFT texts (needs_review = true): general aftercare
-- guidance, to be reviewed and adjusted by the dentist before patients get
-- them. Linked to the starter categories by name, when the practice still
-- has them. Only seeds a practice with no topics yet, so re-running never
-- duplicates or resurrects deleted ones.
create or replace function public.seed_default_aftercare_topics(p_practice_id uuid)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_topic uuid;
  v_seed record;
begin
  if exists (select 1 from public.aftercare_topics where practice_id = p_practice_id) then
    return;
  end if;
  for v_seed in
    select * from (values
      (10, 'Po izdrtju zoba', array['Kirurgija'], $t$– Gazo trdno stiskajte med zobmi 30 minut, nato jo odstranite.
– Dokler popušča anestezija (2–3 ure), ne jejte in ne pijte vročega — da se ne ugriznete v lice ali ustnico.
– Prvih 24 ur ne izpirajte ust, ne pljuvajte in ne pijte po slamici: krvni strdek mora ostati v rani.
– Vsaj 24 ur ne kadite in ne pijte alkohola.
– Na lice lahko polagate hladen obkladek (10 minut, nato premor).
– Prve dni jejte mehko, mlačno hrano in žvečite na drugi strani.
– Zobe ščetkajte kot običajno, ob rani previdno.
– Ob bolečini vzemite protibolečinsko zdravilo, kot vam je bilo svetovano.

Če krvavitev ne preneha, ponovno 30 minut stiskajte čisto gazo. Če krvavitev, bolečina ali oteklina po 2–3 dneh narašča ali dobite vročino, nas pokličite.$t$),
      (20, 'Po zalivki (plombi)', array['Restavrativa'], $t$– Dokler popušča anestezija (2–3 ure), ne jejte in ne pijte vročega.
– Po beli (kompozitni) zalivki lahko jeste takoj, ko anestezija popusti.
– Zob je lahko nekaj dni občutljiv na mraz, toploto ali ugriz; to običajno samo mine.
– Redno ščetkajte in čistite medzobne prostore, da ob robu zalivke ne nastane nov karies.

Če je zalivka previsoka (zob se ob ugrizu dotakne prej kot ostali) ali če občutljivost po nekaj dneh ne pojenja ali se stopnjuje, nas pokličite — pregled je hiter.$t$),
      (30, 'Po endodontskem zdravljenju (zdravljenju kanalov)', array['Endodontija'], $t$– Zob je lahko nekaj dni občutljiv na ugriz; po potrebi vzemite protibolečinsko zdravilo, kot vam je bilo svetovano.
– Dokler zdravljenje ni končano in zob nima dokončne zalivke ali prevleke, na njem ne grizite trde hrane — začasna zalivka in zob sta krhka.
– Če začasna zalivka odpade, nas obvestite.
– Zob po zdravljenju kanalov je bolj krhek in pogosto potrebuje prevleko (krono); o tem se bomo pogovorili.

Če se pojavi oteklina, močna ali naraščajoča bolečina ali vročina, nas takoj pokličite.$t$),
      (40, 'Po vstavitvi implantata', array['Implantologija'], $t$– Gazo stiskajte 30 minut. Prvi dan ne izpirajte ust in ne pijte po slamici.
– Prva 2 dni hladite lice (10 minut, nato premor); manjša oteklina in modrica sta običajni.
– Vsaj nekaj dni ne kadite — kajenje močno poveča tveganje, da se implantat ne vraste.
– Prve dni jejte mehko, mlačno hrano in ne žvečite na mestu implantata.
– Zobe ščetkajte kot običajno, mesto implantata previdno z mehko ščetko.
– Zdravila (antibiotik, protibolečinsko zdravilo, ustno vodo) uporabljajte po navodilih.
– Na kontrolo in odstranitev šivov pridite ob dogovorjenem terminu.

Ob močni krvavitvi, naraščajoči bolečini ali oteklini ali vročini nas pokličite.$t$),
      (50, 'Pravilno ščetkanje zob', array['Preventiva', 'Parodontologija'], $t$– Zobe ščetkajte dvakrat na dan po 2 minuti, z mehko ščetko in zobno pasto s fluoridom.
– Ščetko nagnite proti dlesni in z majhnimi krožnimi gibi očistite vse ploskve zob — zunanje, notranje in žvečne.
– Enkrat na dan očistite medzobne prostore z zobno nitko ali medzobno ščetko.
– Po ščetkanju pasto izpljunite, ust pa ne izpirajte z vodo — fluorid tako dlje ščiti zobe.
– Ščetko ali nastavek električne ščetke zamenjajte vsake 3 mesece oziroma prej, ko se ščetine razkrečijo.
– Omejite sladke prigrizke in pijače med obroki.$t$)
    ) as s(sort_order, title, categories, body)
  loop
    insert into public.aftercare_topics (practice_id, title, body, sort_order, needs_review)
    values (p_practice_id, v_seed.title, v_seed.body, v_seed.sort_order, true)
    returning id into v_topic;
    insert into public.aftercare_topic_categories (practice_id, topic_id, category_id)
    select p_practice_id, v_topic, c.id
    from public.service_categories c
    where c.practice_id = p_practice_id and c.name = any (v_seed.categories);
  end loop;
end;
$$;
revoke execute on function public.seed_default_aftercare_topics(uuid) from public, anon, authenticated;

-- Backfill every existing practice...
do $$
declare
  p record;
begin
  for p in select id from public.practices loop
    perform public.seed_default_aftercare_topics(p.id);
  end loop;
end;
$$;

-- ...and every future one: the signup trigger (020's version) now also
-- seeds the topics, after the categories they link to.
create or replace function public.handle_new_user_practice()
returns trigger language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  new_practice_id uuid;
  practice_name text;
begin
  practice_name := coalesce(nullif(trim(new.raw_user_meta_data->>'practice_name'), ''), 'New practice');
  practice_name := left(practice_name, 200);
  insert into practices (name) values (practice_name) returning id into new_practice_id;
  insert into practice_members (practice_id, user_id, role) values (new_practice_id, new.id, 'owner');
  perform public.seed_default_service_categories(new_practice_id);
  perform public.seed_default_aftercare_topics(new_practice_id);
  return new;
end;
$$;

commit;
