import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // DB tests share one database; run files sequentially.
    fileParallelism: false,
    env: {
      DATABASE_URL: process.env.DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/crave_test',
      SUPABASE_JWT_SECRET: 'test-only-jwt-secret-at-least-32-characters-long',
      NODE_ENV: 'test',
    },
  },
});
