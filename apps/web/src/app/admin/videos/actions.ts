'use server';
import { revalidatePath } from 'next/cache';
import { apiFetch } from '@/lib/api';

/** Moderation runs in the API (service role) because publishing copies the file to the public playback bucket. */
export async function moderate(videoId: string, decision: 'publish' | 'reject' | 'remove', form: FormData) {
  const notes = String(form.get('notes') ?? '').trim() || null;
  await apiFetch(`/v1/admin/videos/${videoId}/moderate`, { body: { decision, notes } });
  revalidatePath('/admin/videos');
}
