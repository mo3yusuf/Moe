-- public_profiles was a SECURITY DEFINER view (it bypassed row-level security to show everyone's
-- public fields). Supabase's security advisor flags that pattern as critical. Same privacy, done the
-- recommended way: the API roles may only read the public profile columns, row-level security lets
-- anyone read non-deleted profiles (and your own), and the view runs with the caller's rights.

revoke select on public.profiles from anon, authenticated;
-- deletion_requested_at is readable only so the view can filter on it: other people's deleted rows are
-- already hidden by the policy below, so it can never reveal anything about them.
grant select (id, display_name, username, avatar_url, bio, deletion_requested_at) on public.profiles to anon, authenticated;

drop policy if exists profiles_self_read on public.profiles;
create policy profiles_read on public.profiles for select to anon, authenticated
  using (deletion_requested_at is null or id = auth.uid());

-- Your own full profile (private fields included).
create or replace function public.my_profile()
returns setof public.profiles
language sql stable security definer set search_path = public as $$
  select * from public.profiles where id = auth.uid();
$$;
revoke all on function public.my_profile() from public, anon;
grant execute on function public.my_profile() to authenticated;

create or replace view public.public_profiles with (security_invoker = true) as
  select p.id, p.display_name, p.username, p.avatar_url, p.bio
  from public.profiles p where p.deletion_requested_at is null;
grant select on public.public_profiles to anon, authenticated;
