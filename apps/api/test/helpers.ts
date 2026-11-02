import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { SignJWT } from 'jose';
import postgres from 'postgres';

export const ids = JSON.parse(readFileSync(join(__dirname, '../../../supabase/demo-ids.json'), 'utf8')) as {
  users: Record<string, string>;
  restaurants: Record<string, string>;
  locations: Record<string, string>;
  items: Record<string, string>;
  options: Record<string, string>;
  videos: Record<string, string>;
};

export const sql = postgres(process.env.DATABASE_URL!, { max: 4, onnotice: () => {} });

export async function tokenFor(userId: string): Promise<string> {
  return new SignJWT({ role: 'authenticated', email: `${userId}@test` })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(userId)
    .setAudience('authenticated')
    .setIssuedAt()
    .setExpirationTime('1h')
    .sign(new TextEncoder().encode(process.env.SUPABASE_JWT_SECRET!));
}

/**
 * Runs `fn` exactly as a Supabase client request would: as the `authenticated`
 * (or `anon`) role with JWT claims set, so RLS policies and triggers apply.
 * The transaction is always rolled back so tests don't leak state.
 */
export async function as<T>(userId: string | null, fn: (tx: postgres.TransactionSql) => Promise<T>): Promise<T> {
  let result: T;
  const rollback = new Error('__rollback__');
  try {
    await sql.begin(async (tx) => {
      const role = userId ? 'authenticated' : 'anon';
      await tx`select set_config('request.jwt.claims', ${JSON.stringify(userId ? { sub: userId, role } : { role })}, true)`;
      await tx.unsafe(`set local role ${role}`);
      result = await fn(tx);
      throw rollback;
    });
  } catch (err) {
    if (err !== rollback) throw err;
  }
  return result!;
}

/** Same as `as`, but expects the operation to fail; returns the Postgres error. */
export async function asExpectError(userId: string | null, fn: (tx: postgres.TransactionSql) => Promise<unknown>): Promise<postgres.PostgresError> {
  try {
    await as(userId, fn);
  } catch (err) {
    return err as postgres.PostgresError;
  }
  throw new Error('Expected the operation to fail, but it succeeded');
}

export const uuid = () => randomUUID();

export function event(type: string, extra: Record<string, unknown> = {}) {
  return { clientEventId: randomUUID(), type, occurredAt: new Date().toISOString(), ...extra };
}
