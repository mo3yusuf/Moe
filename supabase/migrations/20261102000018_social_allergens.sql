-- Comments count, allergen vocabulary and "avoid allergens" preferences.

-- Allergens follow the FSANZ mandatory declaration list (Food Standards Code 1.2.3), simplified.
-- Restaurants declare what a dish CONTAINS; absence of a declaration does not mean allergen-free.
create or replace function public.allowed_allergens() returns text[] language sql immutable as $$
  select array['gluten','wheat','milk','egg','peanut','tree_nuts','sesame','soy','fish','crustacea','mollusc','lupin','sulphites']::text[];
$$;

update public.menu_items set allergens = array(select a from unnest(allergens) a where a = any (public.allowed_allergens()));
alter table public.menu_items add constraint menu_items_allergens_check check (allergens <@ public.allowed_allergens());

alter table public.user_taste_preferences add column avoid_allergens text[] not null default '{}'
  check (avoid_allergens <@ public.allowed_allergens());

-- Keep video_stats.comments in step with visible comments.
create or replace function public.bump_comment_count() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' and not new.is_hidden then
    update public.video_stats set comments = comments + 1, updated_at = now() where video_id = new.video_id;
  elsif tg_op = 'DELETE' and not old.is_hidden then
    update public.video_stats set comments = greatest(comments - 1, 0), updated_at = now() where video_id = old.video_id;
  elsif tg_op = 'UPDATE' and new.is_hidden is distinct from old.is_hidden then
    update public.video_stats set comments = greatest(comments + case when new.is_hidden then -1 else 1 end, 0), updated_at = now() where video_id = new.video_id;
  end if;
  return null;
end $$;
create trigger video_comments_count after insert or update or delete on public.video_comments
  for each row execute function public.bump_comment_count();

-- Followed accounts are visible to their owner only (already enforced by RLS on the follow tables).
