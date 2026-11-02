import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Mux video streaming (https://mux.com): uploads go straight from the phone to Mux, which encodes
 * them into adaptive HLS (up to 1080p) so playback starts fast on any connection and works on every
 * browser. Uses Mux's REST API directly (no SDK).
 */
export interface MuxEvent {
  id: string;
  type: string;
  data: {
    id?: string;
    status?: string;
    passthrough?: string;
    duration?: number;
    upload_id?: string;
    playback_ids?: { id: string; policy: string }[];
    errors?: { messages?: string[] };
  };
}

export interface MuxClient {
  createDirectUpload(o: { corsOrigin: string; passthrough: string }): Promise<{ id: string; url: string }>;
  /** Throws if the signature is missing, wrong or older than 5 minutes. */
  verifyWebhook(rawBody: string, signatureHeader: string, now?: Date): MuxEvent;
}

const TOLERANCE_S = 300;

export function verifyMuxSignature(rawBody: string, header: string, secret: string, now = new Date()): void {
  // Header format: "t=<unix seconds>,v1=<hex HMAC-SHA256 of `${t}.${body}`>"
  const parts = Object.fromEntries(header.split(',').map((p) => p.trim().split('=') as [string, string]));
  const t = Number(parts.t);
  const sig = parts.v1 ?? '';
  if (!t || !sig) throw new Error('missing signature');
  if (Math.abs(now.getTime() / 1000 - t) > TOLERANCE_S) throw new Error('stale signature');
  const expected = createHmac('sha256', secret).update(`${t}.${rawBody}`).digest('hex');
  const a = Buffer.from(sig, 'hex');
  const b = Buffer.from(expected, 'hex');
  if (a.length !== b.length || !timingSafeEqual(a, b)) throw new Error('bad signature');
}

export function muxClient(cfg: { tokenId: string; tokenSecret: string; webhookSecret: string; fetch?: typeof fetch }): MuxClient {
  const f = cfg.fetch ?? fetch;
  const auth = `Basic ${Buffer.from(`${cfg.tokenId}:${cfg.tokenSecret}`).toString('base64')}`;
  async function post(body: unknown) {
    return f('https://api.mux.com/video/v1/uploads', {
      method: 'POST', headers: { Authorization: auth, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
  }
  return {
    async createDirectUpload({ corsOrigin, passthrough }) {
      const base = { playback_policy: ['public'], passthrough };
      // Preferred settings first; if this Mux account/plan rejects an option, fall back to the minimum.
      let res = await post({ cors_origin: corsOrigin, new_asset_settings: { ...base, video_quality: 'basic', max_resolution_tier: '1080p' } });
      if (res.status === 400) res = await post({ cors_origin: corsOrigin, new_asset_settings: base });
      if (!res.ok) throw new Error(`Mux upload create failed (${res.status}): ${(await res.text()).slice(0, 300)}`);
      const json = (await res.json()) as { data?: { id?: string; url?: string } };
      if (!json.data?.id || !json.data.url) throw new Error('Mux upload create: unexpected response');
      return { id: json.data.id, url: json.data.url };
    },
    verifyWebhook(rawBody, header, now) {
      verifyMuxSignature(rawBody, header, cfg.webhookSecret, now);
      return JSON.parse(rawBody) as MuxEvent;
    },
  };
}

export const muxPlaybackUrl = (playbackId: string) => `https://stream.mux.com/${playbackId}.m3u8`;
export const muxThumbnailUrl = (playbackId: string) => `https://image.mux.com/${playbackId}/thumbnail.jpg?time=1`;
