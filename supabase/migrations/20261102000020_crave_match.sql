-- Crave Match: friends swipe the same food videos together; when every member craves the same
-- dish, it's a match. Rooms are joined with a short code, live for 24 hours, and hold up to 12 people.
-- All access goes through the RPCs below (security definer, each guarded by auth.uid() and
-- membership); members can also read their own rooms directly under RLS.

create table public.crave_rooms (
  id          uuid primary key default gen_random_uuid(),
  code        text not null unique check (code ~ '^[A-HJ-NP-Z2-9]{6}$'),
  host_id     uuid not null references auth.users(id) on delete cascade,
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null default now() + interval '24 hours'
);

create table public.crave_room_members (
  room_id    uuid not null references public.crave_rooms(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  joined_at  timestamptz not null default now(),
  primary key (room_id, user_id)
);
create index crave_room_members_user_idx on public.crave_room_members (user_id);

-- The deck: the same videos in the same order for everyone in the room.
create table public.crave_room_videos (
  room_id   uuid not null references public.crave_rooms(id) on delete cascade,
  video_id  uuid not null references public.videos(id) on delete cascade,
  position  integer not null,
  primary key (room_id, video_id)
);

create table public.crave_room_swipes (
  room_id    uuid not null references public.crave_rooms(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  video_id   uuid not null references public.videos(id) on delete cascade,
  direction  text not null check (direction in ('right', 'left')),
  created_at timestamptz not null default now(),
  primary key (room_id, user_id, video_id)
);

create table public.crave_room_matches (
  room_id    uuid not null references public.crave_rooms(id) on delete cascade,
  video_id   uuid not null references public.videos(id) on delete cascade,
  matched_at timestamptz not null default now(),
  primary key (room_id, video_id)
);

alter table public.crave_rooms enable row level security;
alter table public.crave_room_members enable row level security;
alter table public.crave_room_videos enable row level security;
alter table public.crave_room_swipes enable row level security;
alter table public.crave_room_matches enable row level security;

create or replace function public.is_crave_room_member(p_room uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select auth.uid() is not null and exists (
    select 1 from public.crave_room_members m where m.room_id = p_room and m.user_id = auth.uid());
$$;

-- Read-only for members; every write goes through the RPCs.
create policy crave_rooms_read on public.crave_rooms for select to authenticated using (public.is_crave_room_member(id));
create policy crave_room_members_read on public.crave_room_members for select to authenticated using (public.is_crave_room_member(room_id));
create policy crave_room_videos_read on public.crave_room_videos for select to authenticated using (public.is_crave_room_member(room_id));
create policy crave_room_swipes_read on public.crave_room_swipes for select to authenticated using (public.is_crave_room_member(room_id));
create policy crave_room_matches_read on public.crave_room_matches for select to authenticated using (public.is_crave_room_member(room_id));

-- Start a room: host joins, deck = up to 30 recent published videos in a shuffled order.
create or replace function public.create_crave_room() returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_code text;
  v_room uuid;
  v_alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  i int;
begin
  if v_uid is null then raise exception 'Sign in to start a Crave Match' using errcode = '42501'; end if;
  if (select count(*) from public.crave_rooms where host_id = v_uid and created_at > now() - interval '1 hour') >= 10 then
    raise exception 'Too many groups started — try again later' using errcode = 'P0001';
  end if;
  loop
    v_code := '';
    for i in 1..6 loop
      v_code := v_code || substr(v_alphabet, 1 + floor(random() * length(v_alphabet))::int, 1);
    end loop;
    exit when not exists (select 1 from public.crave_rooms where code = v_code);
  end loop;
  insert into public.crave_rooms (code, host_id) values (v_code, v_uid) returning id into v_room;
  insert into public.crave_room_members (room_id, user_id) values (v_room, v_uid);
  insert into public.crave_room_videos (room_id, video_id, position)
    select v_room, d.id, row_number() over (order by random())
    from (select v.id from public.videos v
          where v.status = 'published' and v.playback_url is not null
          order by v.published_at desc nulls last limit 30) d;
  return jsonb_build_object('roomId', v_room, 'code', v_code);
end $$;

-- Join with a code (case-insensitive). Re-joining is harmless.
create or replace function public.join_crave_room(p_code text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_room public.crave_rooms;
begin
  if v_uid is null then raise exception 'Sign in to join a Crave Match' using errcode = '42501'; end if;
  select * into v_room from public.crave_rooms where code = upper(trim(p_code));
  if v_room.id is null then raise exception 'No group with that code' using errcode = 'P0002'; end if;
  if v_room.expires_at < now() then raise exception 'This group has ended — start a new one' using errcode = 'P0001'; end if;
  if not exists (select 1 from public.crave_room_members where room_id = v_room.id and user_id = v_uid)
     and (select count(*) from public.crave_room_members where room_id = v_room.id) >= 12 then
    raise exception 'This group is full (12 people)' using errcode = 'P0001';
  end if;
  insert into public.crave_room_members (room_id, user_id) values (v_room.id, v_uid) on conflict do nothing;
  return jsonb_build_object('roomId', v_room.id, 'code', v_room.code);
end $$;

-- Record a swipe. A video becomes a match when at least two members are in the room and every
-- member has swiped right on it.
create or replace function public.crave_room_swipe(p_room uuid, p_video uuid, p_direction text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_members int;
  v_rights int;
  v_new_match boolean := false;
begin
  if v_uid is null or not public.is_crave_room_member(p_room) then
    raise exception 'Not a member of this group' using errcode = '42501';
  end if;
  if p_direction not in ('right', 'left') then raise exception 'Invalid swipe' using errcode = '22023'; end if;
  if not exists (select 1 from public.crave_room_videos where room_id = p_room and video_id = p_video) then
    raise exception 'That video is not in this group' using errcode = '22023';
  end if;
  if (select expires_at from public.crave_rooms where id = p_room) < now() then
    raise exception 'This group has ended' using errcode = 'P0001';
  end if;
  insert into public.crave_room_swipes (room_id, user_id, video_id, direction) values (p_room, v_uid, p_video, p_direction)
    on conflict (room_id, user_id, video_id) do update set direction = excluded.direction, created_at = now();

  select count(*) into v_members from public.crave_room_members where room_id = p_room;
  select count(*) into v_rights from public.crave_room_swipes s
    join public.crave_room_members m on m.room_id = s.room_id and m.user_id = s.user_id
    where s.room_id = p_room and s.video_id = p_video and s.direction = 'right';
  if v_members >= 2 and v_rights = v_members then
    insert into public.crave_room_matches (room_id, video_id) values (p_room, p_video) on conflict do nothing;
    v_new_match := found;
  end if;
  return jsonb_build_object('matched', v_new_match, 'videoId', p_video, 'rights', v_rights, 'members', v_members);
end $$;

-- Everything the room screen needs in one call (polled every few seconds while open).
create or replace function public.crave_room_state(p_room uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null or not public.is_crave_room_member(p_room) then
    raise exception 'Not a member of this group' using errcode = '42501';
  end if;
  return (
    select jsonb_build_object(
      'roomId', r.id, 'code', r.code, 'hostId', r.host_id, 'expiresAt', r.expires_at, 'me', v_uid,
      'members', coalesce((
        select jsonb_agg(jsonb_build_object(
          'userId', m.user_id,
          'name', coalesce(nullif(p.display_name, ''), 'Friend'),
          'swiped', (select count(*) from public.crave_room_swipes s where s.room_id = r.id and s.user_id = m.user_id))
          order by m.joined_at)
        from public.crave_room_members m left join public.profiles p on p.id = m.user_id
        where m.room_id = r.id), '[]'::jsonb),
      'deck', coalesce((
        select jsonb_agg(jsonb_build_object(
          'videoId', v.id, 'playbackUrl', v.playback_url, 'thumbnailUrl', v.thumbnail_url, 'caption', v.caption,
          'restaurantId', v.restaurant_id, 'restaurantName', rs.name,
          'myDirection', (select s.direction from public.crave_room_swipes s where s.room_id = r.id and s.user_id = v_uid and s.video_id = v.id),
          'rights', (select count(*) from public.crave_room_swipes s where s.room_id = r.id and s.video_id = v.id and s.direction = 'right'))
          order by d.position)
        from public.crave_room_videos d
        join public.videos v on v.id = d.video_id and v.status = 'published'
        left join public.restaurants rs on rs.id = v.restaurant_id
        where d.room_id = r.id), '[]'::jsonb),
      'matches', coalesce((
        select jsonb_agg(jsonb_build_object('videoId', x.video_id, 'matchedAt', x.matched_at) order by x.matched_at)
        from public.crave_room_matches x where x.room_id = r.id), '[]'::jsonb))
    from public.crave_rooms r where r.id = p_room);
end $$;

revoke all on function public.create_crave_room() from public, anon;
revoke all on function public.join_crave_room(text) from public, anon;
revoke all on function public.crave_room_swipe(uuid, uuid, text) from public, anon;
revoke all on function public.crave_room_state(uuid) from public, anon;
grant execute on function public.create_crave_room() to authenticated;
grant execute on function public.join_crave_room(text) to authenticated;
grant execute on function public.crave_room_swipe(uuid, uuid, text) to authenticated;
grant execute on function public.crave_room_state(uuid) to authenticated;
grant select on public.crave_rooms, public.crave_room_members, public.crave_room_videos, public.crave_room_swipes, public.crave_room_matches to authenticated;
