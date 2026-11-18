import * as Sentry from '@sentry/node';

export type ErrorReporter = (err: unknown, context?: Record<string, unknown>) => void;

/**
 * Crash reporting (sentry.io). Off unless SENTRY_DSN is set. No personal data is sent: no IPs,
 * cookies or auth headers, and request bodies are never attached.
 */
export function initSentry(dsn: string | undefined, environment: string): ErrorReporter | null {
  if (!dsn) return null;
  Sentry.init({
    dsn,
    environment,
    release: process.env.RENDER_GIT_COMMIT,
    dataCollection: { userInfo: false, cookies: false, httpHeaders: false, httpBodies: [], urlQueryParams: false },
    tracesSampleRate: 0,
    beforeSend(event) {
      if (event.request) {
        delete event.request.cookies;
        delete event.request.data;
        if (event.request.headers) {
          for (const h of Object.keys(event.request.headers)) if (/authorization|cookie|signature|api-key/i.test(h)) delete event.request.headers[h];
        }
      }
      delete event.user;
      return event;
    },
  });
  return (err, context) => { Sentry.captureException(err, context ? { extra: context } : undefined); };
}
