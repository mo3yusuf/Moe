import { describe, expect, it, vi } from 'vitest';
import { authed, makeApp } from './helpers';

const RID = '11111111-1111-4111-8111-111111111111';

describe('discovery', () => {
  it('logs searches only with personalisation consent', async () => {
    const logSearch = vi.fn(async () => {});
    const nearbyRestaurants = vi.fn(async () => []);
    for (const consent of [true, false]) {
      const app = makeApp({ nearbyRestaurants, logSearch, hasConsent: async () => consent });
      const res = await app.request('/v1/restaurants?q=sushi&lat=-27.4&lng=153', authed('u'));
      expect(res.status).toBe(200);
    }
    expect(logSearch).toHaveBeenCalledTimes(1);
    expect(nearbyRestaurants).toHaveBeenCalledWith(expect.objectContaining({ query: 'sushi', lat: -27.4, maxKm: 15 }));
  });

  it('404s for unknown or invalid restaurant ids', async () => {
    const app = makeApp({ restaurantDetail: async () => null });
    expect((await app.request(`/v1/restaurants/${RID}`, authed('u'))).status).toBe(404);
    expect((await app.request('/v1/restaurants/not-a-uuid', authed('u'))).status).toBe(404);
  });

  it('follows for the signed-in user only', async () => {
    const setFollow = vi.fn(async () => {});
    const app = makeApp({ setFollow });
    await app.request(`/v1/restaurants/${RID}/follow`, authed('me', { method: 'PUT', body: JSON.stringify({ follow: true }) }));
    expect(setFollow).toHaveBeenCalledWith('me', RID, true);
  });
});

describe('admin moderation', () => {
  it('is admin-only', async () => {
    const moderateVideo = vi.fn();
    const app = makeApp({ isAdmin: async () => false, moderateVideo });
    const res = await app.request(`/v1/admin/videos/${RID}/moderate`, authed('u', { method: 'POST', body: JSON.stringify({ decision: 'publish' }) }));
    expect(res.status).toBe(403);
    expect(moderateVideo).not.toHaveBeenCalled();
  });

  it('requires a reason to reject, and reports missing uploads', async () => {
    const app = makeApp({ isAdmin: async () => true, moderateVideo: async () => 'missing_upload' as const });
    const noReason = await app.request(`/v1/admin/videos/${RID}/moderate`, authed('a', { method: 'POST', body: JSON.stringify({ decision: 'reject' }) }));
    expect(noReason.status).toBe(400);
    const publish = await app.request(`/v1/admin/videos/${RID}/moderate`, authed('a', { method: 'POST', body: JSON.stringify({ decision: 'publish' }) }));
    expect(publish.status).toBe(400);
    expect((await publish.json() as any).error.code).toBe('missing_upload');
  });

  it('publishes as the acting admin', async () => {
    const moderateVideo = vi.fn(async () => 'ok' as const);
    const app = makeApp({ isAdmin: async () => true, moderateVideo });
    const res = await app.request(`/v1/admin/videos/${RID}/moderate`, authed('admin-1', { method: 'POST', body: JSON.stringify({ decision: 'publish', notes: 'Looks good' }) }));
    expect(res.status).toBe(200);
    expect(moderateVideo).toHaveBeenCalledWith('admin-1', RID, 'publish', 'Looks good');
  });
});
