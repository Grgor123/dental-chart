-- Staff invitations (Nastavitve → Uporabniki). An owner invites a person by
-- email; the practice-users Edge Function records the invitation here, then
-- creates the auth user through the admin API — which fires
-- handle_new_user_practice() below. That trigger now joins the new user to the
-- inviting practice (with the invited role) when a pending invitation for the
-- address exists, instead of creating a brand-new practice for them.
--
-- Security: only the Edge Function (service role, after checking the caller
-- is an owner) writes invitations — there are no insert/update/delete
-- policies — so nobody can attach themselves to a practice by inventing an
-- invitation. Open sign-up is switched off in Supabase Auth as well. Still no
-- self-service INSERT policy on practice_members (see CLAUDE.md
-- "Multi-tenancy" → footguns).
begin;

create table public.practice_invitations (
  id uuid primary key default gen_random_uuid(),
  practice_id uuid not null references public.practices(id),
  email text not null check (email = lower(trim(email)) and email like '%@%'),
  full_name text,
  role text not null default 'staff' check (role in ('owner', 'staff')),
  invited_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  -- Set by the signup trigger when the auth user is created and joined.
  linked_at timestamptz,
  user_id uuid references auth.users(id) on delete set null
);
create index practice_invitations_pending_email_idx on public.practice_invitations(email) where linked_at is null;
create index practice_invitations_practice_id_idx on public.practice_invitations(practice_id);

alter table public.practice_invitations enable row level security;
create policy practice_invitations_select on public.practice_invitations for select
  using (practice_id = public.current_practice_id());

-- 035's version, plus: a pending invitation for the new user's address joins
-- them to that practice (and fills in their name in user_profiles) instead of
-- creating a new practice.
create or replace function public.handle_new_user_practice()
returns trigger language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  new_practice_id uuid;
  practice_name text;
  inv public.practice_invitations;
begin
  select * into inv from public.practice_invitations
  where email = lower(trim(new.email)) and linked_at is null
  order by created_at desc
  limit 1;
  if inv.id is not null then
    insert into practice_members (practice_id, user_id, role) values (inv.practice_id, new.id, inv.role)
      on conflict do nothing;
    update public.practice_invitations set linked_at = now(), user_id = new.id where id = inv.id;
    if nullif(trim(inv.full_name), '') is not null then
      insert into public.user_profiles (user_id, practice_id, full_name)
      values (new.id, inv.practice_id, trim(inv.full_name))
      on conflict (user_id) do nothing;
    end if;
    return new;
  end if;

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
