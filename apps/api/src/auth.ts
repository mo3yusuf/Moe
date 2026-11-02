import type { MiddlewareHandler } from 'hono';
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from 'jose';
import { env } from './env';
import { unauthorized } from './errors';

export interface AuthUser {
  id: string;
  email: string | null;
}

export type AuthVariables = { user: AuthUser | null };

let jwks: ReturnType<typeof createRemoteJWKSet> | null = null;

/** Verifies a Supabase access token (HS256 secret locally, JWKS for asymmetric keys). */
export async function verifyAccessToken(token: string): Promise<AuthUser> {
  const e = env();
  let payload: JWTPayload;
  try {
    if (e.SUPABASE_JWT_SECRET) {
      ({ payload } = await jwtVerify(token, new TextEncoder().encode(e.SUPABASE_JWT_SECRET), { audience: 'authenticated' }));
    } else {
      jwks ??= createRemoteJWKSet(new URL(`${e.SUPABASE_URL}/auth/v1/.well-known/jwks.json`));
      ({ payload } = await jwtVerify(token, jwks, { audience: 'authenticated' }));
    }
  } catch {
    throw unauthorized('Invalid or expired session');
  }
  if (!payload.sub || payload.role !== 'authenticated') throw unauthorized('Invalid session');
  return { id: payload.sub, email: typeof payload.email === 'string' ? payload.email : null };
}

/** Attaches the user if a valid bearer token is present. Never throws for missing tokens. */
export const optionalAuth: MiddlewareHandler<{ Variables: AuthVariables }> = async (c, next) => {
  const header = c.req.header('authorization');
  c.set('user', header?.startsWith('Bearer ') ? await verifyAccessToken(header.slice(7)) : null);
  await next();
};

export const requireAuth: MiddlewareHandler<{ Variables: AuthVariables }> = async (c, next) => {
  const header = c.req.header('authorization');
  if (!header?.startsWith('Bearer ')) throw unauthorized();
  c.set('user', await verifyAccessToken(header.slice(7)));
  await next();
};
