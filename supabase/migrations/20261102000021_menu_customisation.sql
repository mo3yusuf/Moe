-- Uber Eats-style customisation: option quantities, nested choices, remove-ingredient chips,
-- option photos and combo meals. All columns have safe defaults, so existing menus are unchanged.

alter table public.menu_item_options
  add column max_quantity smallint not null default 1 check (max_quantity between 1 and 20),
  add column image_url text check (image_url is null or image_url ~ '^https://'),
  -- Combos: the menu item this choice stands for (e.g. "Coke" in a meal deal).
  add column linked_menu_item_id uuid references public.menu_items(id) on delete set null;

alter table public.menu_item_option_groups
  -- Nested choice: the group only applies when this option is picked (e.g. Fries → sauce).
  add column parent_option_id uuid references public.menu_item_options(id) on delete cascade,
  add column display_style text not null default 'list' check (display_style in ('list', 'chips', 'remove'));

alter table public.menu_items
  add column is_combo boolean not null default false;

create index option_groups_parent_idx on public.menu_item_option_groups (parent_option_id);
create index options_linked_item_idx on public.menu_item_options (linked_menu_item_id);

-- A nested group must hang off an option of the same menu item (no cross-item or self references).
create or replace function public.check_option_group_parent() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.parent_option_id is not null and not exists (
    select 1 from public.menu_item_options o join public.menu_item_option_groups g on g.id = o.group_id
    where o.id = new.parent_option_id and g.menu_item_id = new.menu_item_id and g.id <> new.id) then
    raise exception 'A nested group must belong to an option of the same dish' using errcode = '22023';
  end if;
  return new;
end $$;
create trigger option_groups_parent_check before insert or update on public.menu_item_option_groups
  for each row execute function public.check_option_group_parent();

-- A combo choice may only link to a dish from the same restaurant.
create or replace function public.check_option_link() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.linked_menu_item_id is not null and not exists (
    select 1 from public.menu_items linked
    join public.menu_item_option_groups g on g.id = new.group_id
    join public.menu_items owner on owner.id = g.menu_item_id
    where linked.id = new.linked_menu_item_id and linked.restaurant_id = owner.restaurant_id) then
    raise exception 'A combo choice must link to a dish from the same restaurant' using errcode = '22023';
  end if;
  return new;
end $$;
create trigger options_link_check before insert or update on public.menu_item_options
  for each row execute function public.check_option_link();
