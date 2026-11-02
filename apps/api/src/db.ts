import postgres from 'postgres';
import { env } from './env';

export type Sql = postgres.Sql;
export type Tx = postgres.TransactionSql;

let client: Sql | null = null;

/**
 * Privileged server-side connection. Authorisation is enforced in the service
 * layer for every query; RLS protects direct client access via Supabase.
 */
export function db(): Sql {
  if (!client) {
    client = postgres(env().DATABASE_URL, {
      max: 10,
      idle_timeout: 20,
      transform: { undefined: null },
      onnotice: () => {},
    });
  }
  return client;
}

export async function closeDb(): Promise<void> {
  if (client) await client.end({ timeout: 5 });
  client = null;
}
