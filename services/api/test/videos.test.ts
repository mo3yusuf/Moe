import { createHmac } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { muxClient, verifyMuxSignature } from '../src/lib/mux';
import { authed, makeApp } from './helpers';

const VIDEO = '00000000-0000-4000-8000-000000000v01'.replace('v01', 'a01');
const USER = '00000000-0000-4000-8000-0000000000u1'.replace('u1', 'c1');
const SECRET = 'whsec_test_secret';
const NOW = new Date('2026-11-02T12:00:00Z');

const sign = (body: string, t = Math.floor(NOW.getTime() / 1000)) =>
  `t=${t},v1=${createHmac('sha256', SECRET).update(`${t}.${body}`).digest('hex')}`;

function fakeMux() {
  const created: { corsOrigin: string; passthrough: string }[] = [];
  return {
    created,
    client: {
      async createDirectUpload(o: { corsOrigin: string; passthrough: string }) { created.push(o); return { id: 'up_1', url: 'https://storage.mux.com/upload/abc' }; },
      verifyWebhook(raw: string, header: string, now?: Date) { verifyMuxSignature(raw, header, SECRET, now); return JSON.parse(raw); },
    },
  };
}

function store(over: Record<string, unknown> = {}) {
  const seen = new Set<string>();
  return {
    videoAwaitingUpload: vi.fn(async (userId: string, id: string) => (userId === USER && id === VIDEO ? { id } : null)),
    markStreamUpload: vi.fn(async () => {}),
    attachStream: vi.fn(async () => true),
    failStream: vi.fn(async () => {}),
    beginWebhook: vi.fn(async (id: string) => { if (seen.has(id)) return false; seen.add(id); return true; }),
    finishWebhook: vi.fn(async () => {}),
    ...over,
  };
}

describe('POST /v1/videos/:id/upload', () => {
  it('returns 503 when Mux is not configured so the app falls back to Supabase Storage', async () => {
    const res = await makeApp(store()).request(`/v1/videos/${VIDEO}/upload`, authed(USER, { method: 'POST' }));
    expect(res.status).toBe(503);
  });

  it('only issues upload URLs for the caller’s own video awaiting its file', async () => {
    const mux = fakeMux();
    const res = await makeApp(store(), { mux: mux.client }).request(`/v1/videos/${VIDEO}/upload`, authed('someone-else', { method: 'POST' }));
    expect(res.status).toBe(404);
    expect(mux.created).toHaveLength(0);
  });

  it('creates a Mux direct upload tied to the video and the app origin', async () => {
    const mux = fakeMux();
    const s = store();
    const app = makeApp(s, { mux: mux.client, corsOrigins: ['http://localhost:8081', 'https://crave-app.onrender.com'] });
    const res = await app.request(`/v1/videos/${VIDEO}/upload`, authed(USER, { method: 'POST', headers: { Origin: 'https://crave-app.onrender.com' } }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ uploadUrl: 'https://storage.mux.com/upload/abc', method: 'PUT', provider: 'mux' });
    expect(mux.created).toEqual([{ corsOrigin: 'https://crave-app.onrender.com', passthrough: VIDEO }]);
    expect(s.markStreamUpload).toHaveBeenCalledWith(VIDEO, 'mux', 'up_1');
  });
});

describe('POST /webhooks/mux', () => {
  const ready = JSON.stringify({
    id: 'evt_1', type: 'video.asset.ready',
    data: { id: 'asset_1', passthrough: VIDEO, duration: 12.93, playback_ids: [{ id: 'pb123', policy: 'public' }] },
  });

  it('attaches the stream when Mux reports the asset is ready (once per event)', async () => {
    const s = store();
    const app = makeApp(s, { mux: fakeMux().client, now: () => NOW });
    const send = () => app.request('/webhooks/mux', { method: 'POST', body: ready, headers: { 'mux-signature': sign(ready) } });
    expect((await send()).status).toBe(200);
    expect(s.attachStream).toHaveBeenCalledWith(VIDEO, {
      assetId: 'asset_1', playbackUrl: 'https://stream.mux.com/pb123.m3u8',
      thumbnailUrl: 'https://image.mux.com/pb123/thumbnail.jpg?time=1', durationMs: 12930,
    });
    expect(await (await send()).json()).toMatchObject({ duplicate: true });
    expect(s.attachStream).toHaveBeenCalledTimes(1);
  });

  it('rejects bad, missing and stale signatures', async () => {
    const s = store();
    const app = makeApp(s, { mux: fakeMux().client, now: () => NOW });
    for (const header of ['', 't=1,v1=deadbeef', sign(ready, Math.floor(NOW.getTime() / 1000) - 600), sign(`${ready} `)]) {
      const res = await app.request('/webhooks/mux', { method: 'POST', body: ready, headers: { 'mux-signature': header } });
      expect(res.status).toBe(400);
    }
    expect(s.attachStream).not.toHaveBeenCalled();
  });

  it('marks the video failed when Mux cannot process it, and ignores videos that are not ours', async () => {
    const s = store();
    const app = makeApp(s, { mux: fakeMux().client, now: () => NOW });
    const errored = JSON.stringify({ id: 'evt_2', type: 'video.asset.errored', data: { passthrough: VIDEO, errors: { messages: ['bad file'] } } });
    await app.request('/webhooks/mux', { method: 'POST', body: errored, headers: { 'mux-signature': sign(errored) } });
    expect(s.failStream).toHaveBeenCalledWith(VIDEO, 'bad file');
    const foreign = JSON.stringify({ id: 'evt_3', type: 'video.asset.ready', data: { id: 'a', passthrough: 'other-app', playback_ids: [{ id: 'x', policy: 'public' }] } });
    expect((await app.request('/webhooks/mux', { method: 'POST', body: foreign, headers: { 'mux-signature': sign(foreign) } })).status).toBe(200);
    expect(s.attachStream).not.toHaveBeenCalled();
  });
});

describe('muxClient', () => {
  it('uses basic auth and falls back to minimal settings if Mux rejects the preferred ones', async () => {
    const calls: { auth: string; body: any }[] = [];
    const f = vi.fn(async (_url: string, init: RequestInit) => {
      calls.push({ auth: (init.headers as Record<string, string>).Authorization!, body: JSON.parse(String(init.body)) });
      return calls.length === 1
        ? new Response('{"error":{"messages":["invalid video_quality"]}}', { status: 400 })
        : new Response(JSON.stringify({ data: { id: 'up_9', url: 'https://storage.mux.com/u' } }), { status: 201 });
    });
    const client = muxClient({ tokenId: 'id', tokenSecret: 'secret', webhookSecret: SECRET, fetch: f as unknown as typeof fetch });
    expect(await client.createDirectUpload({ corsOrigin: 'https://a.example', passthrough: VIDEO })).toEqual({ id: 'up_9', url: 'https://storage.mux.com/u' });
    expect(calls[0]!.auth).toBe(`Basic ${Buffer.from('id:secret').toString('base64')}`);
    expect(calls[0]!.body.new_asset_settings).toMatchObject({ playback_policy: ['public'], passthrough: VIDEO, video_quality: 'basic', max_resolution_tier: '1080p' });
    expect(calls[1]!.body).toEqual({ cors_origin: 'https://a.example', new_asset_settings: { playback_policy: ['public'], passthrough: VIDEO } });
  });
});
