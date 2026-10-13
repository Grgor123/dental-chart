-- Extractions ("puljenje") are not surgery: Kirurgija is for surgical
-- procedures (bone grafting, surgical extraction …). Per Gregor's correction
-- (2026-10-12):
--   - a new starter category "Puljenje" (every practice, and new ones);
--   - the extraction aftercare topic is called "Po puljenju zoba" and is
--     linked to Puljenje instead of Kirurgija. Kirurgija gets no topic for now.
-- Existing practices: the topic is renamed only while it's still the
-- untouched starter text (needs_review), so a practice's own edit is kept;
-- the Kirurgija → Puljenje link is moved either way.
begin;

-- ---- Category for every existing practice ---------------------------------------
insert into public.service_categories (practice_id, name, sort_order)
select p.id, 'Puljenje', 55
from public.practices p
where not exists (
  select 1 from public.service_categories c where c.practice_id = p.id and lower(c.name) = 'puljenje'
);

-- ---- The extraction topic --------------------------------------------------------
update public.aftercare_topics
set title = 'Po puljenju zoba', updated_at = now()
where title = 'Po izdrtju zoba' and needs_review;

delete from public.aftercare_topic_categories l
using public.aftercare_topics t, public.service_categories c
where l.topic_id = t.id and l.category_id = c.id
  and t.title = 'Po puljenju zoba' and c.name = 'Kirurgija';

insert into public.aftercare_topic_categories (practice_id, topic_id, category_id)
select t.practice_id, t.id, c.id
from public.aftercare_topics t
join public.service_categories c on c.practice_id = t.practice_id and c.name = 'Puljenje'
where t.title = 'Po puljenju zoba'
on conflict do nothing;

-- ---- Starter sets for new practices ------------------------------------------------
create or replace function public.seed_default_service_categories(p_practice_id uuid)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if exists (select 1 from public.service_categories where practice_id = p_practice_id) then
    return;
  end if;
  insert into public.service_categories (practice_id, name, sort_order) values
    (p_practice_id, 'Preventiva', 10),
    (p_practice_id, 'Diagnostika in RTG', 20),
    (p_practice_id, 'Restavrativa', 30),
    (p_practice_id, 'Endodontija', 40),
    (p_practice_id, 'Parodontologija', 50),
    (p_practice_id, 'Puljenje', 55),
    (p_practice_id, 'Kirurgija', 60),
    (p_practice_id, 'Implantologija', 70),
    (p_practice_id, 'Protetika', 80),
    (p_practice_id, 'Ortodontija', 90);
end;
$$;

-- Same as 034's version, with the extraction topic renamed and linked to
-- Puljenje.
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
      (10, 'Po puljenju zoba', array['Puljenje'], $t$– Gazo trdno stiskajte med zobmi 30 minut, nato jo odstranite.
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
revoke execute on function public.seed_default_service_categories(uuid) from public, anon, authenticated;

commit;
