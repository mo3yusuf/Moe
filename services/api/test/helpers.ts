import { createApp, type AppDeps } from '../src/app';
import type { AuthVerifier } from '../src/lib/auth';
import type { DataStore } from '../src/lib/store';

/** Token format for tests: "test:<userId>". Anything else is rejected. */
export const fakeAuth: AuthVerifier = {
  async verify(token) {
    return token.startsWith('test:') ? { id: token.slice(5) } : null;
  },
};

export function makeApp(store: Partial<DataStore>, extra: Partial<AppDeps> = {}) {
  return createApp({ auth: fakeAuth, store: store as DataStore, corsOrigins: ['http://localhost:3000'], ...extra });
}

export const authed = (userId: string, init: RequestInit = {}): RequestInit => ({
  ...init,
  headers: { Authorization: `Bearer test:${userId}`, 'Content-Type': 'application/json', ...(init.headers ?? {}) },
});
