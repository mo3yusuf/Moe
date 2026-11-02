import { serve } from '@hono/node-server';
import { createApp } from './app';
import { closeDb } from './db';
import { env } from './env';

const app = createApp();
const server = serve({ fetch: app.fetch, port: env().PORT }, (info) => {
  console.log(`CRAVE API listening on http://localhost:${info.port}`);
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    server.close();
    void closeDb().finally(() => process.exit(0));
  });
}
