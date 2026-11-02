-- Storage buckets and object policies.
-- Object paths are namespaced by owner: <bucket>/<user_id>/<file> or <bucket>/<restaurant_id>/<file>.
-- Videos are uploaded privately and only become publicly playable after moderation, when the
-- backend copies/transcodes them to a playback location (or a dedicated streaming provider).

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
  ('video-uploads', 'video-uploads', false, 524288000, array['video/mp4', 'video/quicktime']),
  ('video-playback', 'video-playback', true, 524288000, array['video/mp4', 'application/vnd.apple.mpegurl', 'video/mp2t', 'image/jpeg']),
  ('menu-images', 'menu-images', true, 10485760, array['image/jpeg', 'image/png', 'image/webp']),
  ('avatars', 'avatars', true, 5242880, array['image/jpeg', 'image/png', 'image/webp']),
  ('verification-docs', 'verification-docs', false, 20971520, array['application/pdf', 'image/jpeg', 'image/png'])
on conflict (id) do nothing;

create policy "video uploads: owner write" on storage.objects for insert to authenticated
  with check (bucket_id = 'video-uploads' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "video uploads: owner read" on storage.objects for select to authenticated
  using (bucket_id = 'video-uploads' and ((storage.foldername(name))[1] = auth.uid()::text or public.is_admin()));
create policy "video uploads: owner delete" on storage.objects for delete to authenticated
  using (bucket_id = 'video-uploads' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "avatars: owner write" on storage.objects for insert to authenticated
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "avatars: owner update" on storage.objects for update to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "menu images: restaurant managers write" on storage.objects for insert to authenticated
  with check (bucket_id = 'menu-images'
              and public.can_manage_restaurant(((storage.foldername(name))[1])::uuid));
create policy "menu images: restaurant managers delete" on storage.objects for delete to authenticated
  using (bucket_id = 'menu-images'
         and public.can_manage_restaurant(((storage.foldername(name))[1])::uuid));

create policy "verification docs: managers write" on storage.objects for insert to authenticated
  with check (bucket_id = 'verification-docs'
              and public.can_manage_restaurant(((storage.foldername(name))[1])::uuid));
create policy "verification docs: managers and admins read" on storage.objects for select to authenticated
  using (bucket_id = 'verification-docs'
         and (public.can_manage_restaurant(((storage.foldername(name))[1])::uuid) or public.is_admin()));
-- video-playback: written only by the backend (service role); public buckets are readable by URL.
