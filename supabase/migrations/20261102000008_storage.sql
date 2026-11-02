-- =============================================================================
-- CRAVE — Storage buckets & policies
-- =============================================================================
-- videos         public read (published playback), uploads into {user_id}/...
-- menu-media     public read, restaurant managers upload into {restaurant_id}/...
-- avatars        public read, users upload into {user_id}/...
-- verification   PRIVATE, restaurant owners upload into {restaurant_id}/..., admins read
-- Note: a dedicated streaming provider (Mux / Cloudflare Stream) is recommended
-- before scale; videos.streaming_provider + playback_url support switching.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
  ('videos', 'videos', true, 209715200, array['video/mp4', 'video/quicktime']),
  ('menu-media', 'menu-media', true, 10485760, array['image/jpeg', 'image/png', 'image/webp']),
  ('avatars', 'avatars', true, 5242880, array['image/jpeg', 'image/png', 'image/webp']),
  ('verification', 'verification', false, 15728640, array['application/pdf', 'image/jpeg', 'image/png'])
on conflict (id) do nothing;

create policy "videos: upload own folder" on storage.objects for insert to authenticated
  with check (bucket_id = 'videos' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "videos: delete own" on storage.objects for delete to authenticated
  using (bucket_id = 'videos' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "avatars: upload own folder" on storage.objects for insert to authenticated
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "avatars: replace own" on storage.objects for update to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "menu-media: restaurant managers upload" on storage.objects for insert to authenticated
  with check (bucket_id = 'menu-media' and public.is_restaurant_member(((storage.foldername(name))[1])::uuid, 'manager'));
create policy "menu-media: restaurant managers delete" on storage.objects for delete to authenticated
  using (bucket_id = 'menu-media' and public.is_restaurant_member(((storage.foldername(name))[1])::uuid, 'manager'));

create policy "verification: owners upload" on storage.objects for insert to authenticated
  with check (bucket_id = 'verification' and public.is_restaurant_member(((storage.foldername(name))[1])::uuid, 'owner'));
create policy "verification: owners and admins read" on storage.objects for select to authenticated
  using (bucket_id = 'verification' and (public.is_admin() or public.is_restaurant_member(((storage.foldername(name))[1])::uuid, 'owner')));
