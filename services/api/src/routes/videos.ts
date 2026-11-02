import { Hono } from 'hono';
import { z } from 'zod';
import type { AppEnv } from '../app';
import { ApiError, notFound } from '../lib/errors';
import { muxPlaybackUrl, muxThumbnailUrl, type MuxEvent } from '../lib/mux';
import type { DataStore } from '../lib/store';

const Id = z.string().uuid();

/**
 * POST /v1/videos/:id/upload — returns a one-time Mux upload URL for the caller's own video that is
 * still waiting for its file. 503 when Mux isn't configured: the app then uploads to Supabase Storage.
 */
export const videoUploadRoutes = new Hono<AppEnv>();

videoUploadRoutes.post('/videos/:id/upload', async (c) => {
  const { mux, store, corsOrigins } = c.get('deps');
  if (!mux) throw new ApiError(503, 'streaming_unavailable', 'Streaming uploads are not configured');
  const id = Id.safeParse(c.req.param('id'));
  if (!id.success) throw notFound('Video');
  const video = await store.videoAwaitingUpload(c.get('user').id, id.data);
  if (!video) throw notFound('Video');
  // Mux only accepts the browser upload from this origin; native apps send no Origin.
  const origin = c.req.header('Origin');
  const corsOrigin = origin && corsOrigins.includes(origin) ? origin : (corsOrigins.find((o) => o.startsWith('https://')) ?? '*');
  const upload = await mux.createDirectUpload({ corsOrigin, passthrough: video.id });
  await store.markStreamUpload(video.id, 'mux', upload.id);
  return c.json({ uploadUrl: upload.url, method: 'PUT', provider: 'mux' });
});

/** POST /webhooks/mux — Mux tells us when a video is encoded (or failed). Signature-verified, deduplicated. */
export const muxWebhookRoutes = new Hono<AppEnv>();

muxWebhookRoutes.post('/mux', async (c) => {
  const { mux, store } = c.get('deps');
  if (!mux) return c.json({ error: 'streaming not configured' }, 503);
  const raw = await c.req.text();
  let event: MuxEvent;
  try {
    event = mux.verifyWebhook(raw, c.req.header('mux-signature') ?? '', c.get('deps').now?.());
  } catch {
    return c.json({ error: 'invalid signature' }, 400);
  }
  if (!event.id || !(await store.beginWebhook(`mux:${event.id}`, event.type, event))) return c.json({ received: true, duplicate: true });
  try {
    await handleMuxEvent(store, event);
    await store.finishWebhook(`mux:${event.id}`, null);
    return c.json({ received: true });
  } catch (e) {
    await store.finishWebhook(`mux:${event.id}`, e instanceof Error ? e.message.slice(0, 500) : 'error');
    console.error('[crave-api] mux webhook failed', event.type, e);
    return c.json({ error: 'processing failed' }, 500);
  }
});

export async function handleMuxEvent(store: DataStore, event: MuxEvent): Promise<void> {
  const videoId = Id.safeParse(event.data.passthrough);
  if (!videoId.success) return; // not one of ours
  if (event.type === 'video.asset.ready') {
    const playbackId = event.data.playback_ids?.find((p) => p.policy === 'public')?.id;
    if (!playbackId || !event.data.id) throw new Error('asset ready without a public playback id');
    await store.attachStream(videoId.data, {
      assetId: event.data.id,
      playbackUrl: muxPlaybackUrl(playbackId),
      thumbnailUrl: muxThumbnailUrl(playbackId),
      durationMs: typeof event.data.duration === 'number' ? Math.round(event.data.duration * 1000) : null,
    });
  } else if (event.type === 'video.asset.errored') {
    await store.failStream(videoId.data, event.data.errors?.messages?.join('; ') || 'unknown error');
  }
}
