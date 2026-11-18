import * as Sentry from '@sentry/nextjs';

// Browser crash reporting. NEXT_PUBLIC_SENTRY_DSN is baked in at build time; off when unset.
const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN?.trim();
if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV,
    tracesSampleRate: 0,
    dataCollection: { userInfo: false, cookies: false, httpHeaders: false, httpBodies: [], urlQueryParams: false },
  });
}

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
