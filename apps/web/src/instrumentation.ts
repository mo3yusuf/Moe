import * as Sentry from '@sentry/nextjs';

// Server-side crash reporting (sentry.io). Off unless SENTRY_DSN is set in Render.
export async function register() {
  const dsn = process.env.SENTRY_DSN?.trim();
  if (!dsn) return;
  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV,
    release: process.env.RENDER_GIT_COMMIT,
    tracesSampleRate: 0,
    dataCollection: { userInfo: false, cookies: false, httpHeaders: false, httpBodies: [], urlQueryParams: false },
  });
}

export const onRequestError = Sentry.captureRequestError;
