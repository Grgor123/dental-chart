-- Voice entry learns the practice's own words (Gregor, 2026-10-20): when the
-- browser mishears a dental term ("karje" for karies, "soklo" for okluzalno),
-- staff click the word in the voice panel and say what it means. The mapping
-- is stored here, per practice, and used for every later phrase
-- (src/lib/voice/parseVoiceCommand.ts, option `aliases`).
--
-- heard: one or two words as the recogniser writes them, lower case,
--        without č/š/ž (the parser's own folding);
-- meaning: a word the parser understands ("karies", "okluzalno" …) or
--          "prezri" (ignore it).
begin;

create table public.voice_aliases (
  id uuid primary key default gen_random_uuid(),
  practice_id uuid not null references public.practices(id),
  heard text not null check (heard = lower(heard) and length(heard) between 1 and 60),
  meaning text not null check (length(meaning) between 1 and 40),
  created_by uuid references auth.users(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  unique (practice_id, heard)
);
create index voice_aliases_practice_id_idx on public.voice_aliases(practice_id);

alter table public.voice_aliases enable row level security;
create policy voice_aliases_select on public.voice_aliases for select
  using (practice_id = public.current_practice_id());
create policy voice_aliases_insert on public.voice_aliases for insert
  with check (practice_id = public.current_practice_id());
create policy voice_aliases_update on public.voice_aliases for update
  using (practice_id = public.current_practice_id())
  with check (practice_id = public.current_practice_id());
create policy voice_aliases_delete on public.voice_aliases for delete
  using (practice_id = public.current_practice_id());

commit;
