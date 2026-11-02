import { describe, expect, it } from 'vitest';
import { authed, makeApp } from './helpers';
import { loadEnv } from '../src/env';

describe('api basics', () => {
  it('health is public', async () => {
    const res = await makeApp({}).request('/health');
    expect(res.status).toBe(200);
    expect((await res.json() as any).ok).toBe(true);
  });

  it('rejects requests without a token', async () => {
    const res = await makeApp({}).request('/v1/me');
    expect(res.status).toBe(401);
    expect((await res.json() as any).error.code).toBe('unauthenticated');
  });

  it('rejects invalid tokens', async () => {
    const res = await makeApp({}).request('/v1/me', { headers: { Authorization: 'Bearer nope' } });
    expect(res.status).toBe(401);
    expect((await res.json() as any).error.code).toBe('invalid_token');
  });

  it('returns the signed-in user profile', async () => {
    const app = makeApp({
      getMe: async (id) => ({
        profile: { id, displayName: 'Sam', username: null, avatarUrl: null, homeCityId: null, onboardingCompletedAt: null, tasteResetAt: null },
        roles: ['customer'], restaurants: [], consents: { personalisation: true },
      }),
    });
    const res = await app.request('/v1/me', authed('u1'));
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.profile.id).toBe('u1');
    expect(body.roles).toEqual(['customer']);
  });

  it('does not leak internal errors', async () => {
    const app = makeApp({ getMe: async () => { throw new Error('db password is hunter2'); } });
    const res = await app.request('/v1/me', authed('u1'));
    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json() as any)).not.toContain('hunter2');
  });

  it('sets security headers', async () => {
    const res = await makeApp({}).request('/health');
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
  });
});

describe('env', () => {
  it('fails fast with a helpful message when misconfigured', () => {
    expect(() => loadEnv({})).toThrow(/SUPABASE_URL/);
  });
});
