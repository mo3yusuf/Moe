import { createUploadTask, FileSystemUploadType } from 'expo-file-system/legacy';
import { Platform } from 'react-native';
import { config } from '@/lib/config';
import { supabase } from '@/lib/supabase';

export interface VideoUploadInput {
  fileUri: string;
  mimeType: 'video/mp4' | 'video/quicktime';
  /** Web only: the picked file (browsers can't stream from a file path). */
  webFile?: Blob | null;
  durationMs: number;
  caption: string;
  tag: { restaurantId: string; menuItemId: string } | null;
  isSponsored: boolean;
  sponsorDisclosure: string;
  allowRestaurantReuse: boolean;
  /** The user confirmed they own/licensed the content, incl. music and people shown. */
  rightsConfirmed: boolean;
}

export const MAX_DURATION_MS = 180_000;
export const MIN_DURATION_MS = 3_000;

export function validateUpload(i: VideoUploadInput): string | null {
  if (!i.rightsConfirmed) return 'Please confirm you own or have permission to share this video.';
  if (i.durationMs < MIN_DURATION_MS || i.durationMs > MAX_DURATION_MS) return 'Videos must be between 3 seconds and 3 minutes.';
  if (i.isSponsored && i.sponsorDisclosure.trim().length < 3) return 'Say who sponsored this video (e.g. “Paid partnership with …”).';
  if (i.caption.length > 500) return 'Captions are limited to 500 characters.';
  return null;
}

export const hashtagsOf = (caption: string) =>
  [...new Set((caption.match(/#[\p{L}\p{N}_]{2,30}/gu) ?? []).map((h) => h.slice(1).toLowerCase()))].slice(0, 10);

/**
 * Uploads a video under the user's own session (RLS + storage policies apply):
 *  1. create the video record (the database forces status "uploading"),
 *  2. stream the file from disk to private storage (never loaded into memory),
 *  3. attach metadata and submit for moderation,
 *  4. request the menu-item tag (pending until the restaurant approves).
 */
export async function uploadVideo(input: VideoUploadInput, onProgress: (fraction: number) => void): Promise<{ videoId: string }> {
  if (!supabase) throw new Error('Uploads need a CRAVE backend (demo mode).');
  const invalid = validateUpload(input);
  if (invalid) throw new Error(invalid);
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Please sign in again.');
  const userId = session.user.id;

  const { data: video, error } = await supabase.from('videos').insert({
    uploader_id: userId,
    source: 'customer',
    caption: input.caption.trim() || null,
    hashtags: hashtagsOf(input.caption),
    duration_ms: Math.round(input.durationMs),
    is_sponsored: input.isSponsored,
    sponsor_disclosure: input.isSponsored ? input.sponsorDisclosure.trim() : null,
    allow_restaurant_reuse: input.allowRestaurantReuse,
  }).select('id').single();
  if (error || !video) throw new Error(error?.message ?? 'Could not start upload');

  const path = `${userId}/${video.id}.${input.mimeType === 'video/mp4' ? 'mp4' : 'mov'}`;
  let ok = false;
  let status: number | string = 'network error';
  if (Platform.OS === 'web') {
    // Browsers: upload the File/Blob directly (no progress events from supabase-js; show indeterminate).
    onProgress(0.05);
    const blob = input.webFile ?? (await (await fetch(input.fileUri)).blob());
    const { error: upErr } = await supabase.storage.from('video-uploads').upload(path, blob, { contentType: input.mimeType, upsert: false });
    ok = !upErr;
    status = upErr?.message ?? 200;
    onProgress(1);
  } else {
    const task = createUploadTask(`${config.supabaseUrl}/storage/v1/object/video-uploads/${path}`, input.fileUri, {
      httpMethod: 'POST',
      uploadType: FileSystemUploadType.BINARY_CONTENT,
      headers: {
        Authorization: `Bearer ${session.access_token}`,
        apikey: config.supabaseAnonKey,
        'Content-Type': input.mimeType,
        'x-upsert': 'false',
      },
    }, (p) => onProgress(p.totalBytesExpectedToSend ? p.totalBytesSent / p.totalBytesExpectedToSend : 0));
    const result = await task.uploadAsync();
    ok = !!result && result.status < 300;
    status = result?.status ?? 'network error';
  }
  if (!ok) {
    await supabase.from('videos').delete().eq('id', video.id);
    throw new Error(`Upload failed (${status})`);
  }

  const { error: submitErr } = await supabase.from('videos')
    .update({ storage_path: path, status: 'pending_review', rights_attested_at: new Date().toISOString() })
    .eq('id', video.id);
  if (submitErr) throw new Error(submitErr.message);

  if (input.tag) {
    const { error: tagErr } = await supabase.from('video_menu_items').insert({
      video_id: video.id, menu_item_id: input.tag.menuItemId, restaurant_id: input.tag.restaurantId,
    });
    if (tagErr) throw new Error(`Video uploaded, but tagging failed: ${tagErr.message}`);
  }
  return { videoId: video.id };
}
