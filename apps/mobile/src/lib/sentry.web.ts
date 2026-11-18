/**
 * Crash reporting for the web app (sentry.io). Off unless EXPO_PUBLIC_SENTRY_DSN is set at build time.
 * The SDK is loaded after the first screen is up (a separate small file), so it never slows the
 * feed's first video; errors that happen before then are queued and sent once it loads.
 */
type Sentry = typeof import('@sentry/browser');
const dsn = (process.env.EXPO_PUBLIC_SENTRY_DSN ?? '').trim();
let sdk: Sentry | null = null;
const early: unknown[] = [];

export function reportError(error: unknown): void {
  if (!dsn) return;
  if (sdk) sdk.captureException(error);
  else if (early.length < 20) early.push(error);
}

export function initSentry(): void {
  if (!dsn || typeof window === 'undefined') return;
  const onError = (e: ErrorEvent) => reportError(e.error ?? e.message);
  const onRejection = (e: PromiseRejectionEvent) => reportError(e.reason);
  window.addEventListener('error', onError);
  window.addEventListener('unhandledrejection', onRejection);
  const load = () => import('@sentry/browser').then((S) => {
    // The SDK installs its own global handlers from here on.
    window.removeEventListener('error', onError);
    window.removeEventListener('unhandledrejection', onRejection);
    S.init({
      dsn,
      environment: process.env.NODE_ENV,
      tracesSampleRate: 0,
      dataCollection: { userInfo: false, cookies: false, httpHeaders: false, httpBodies: [], urlQueryParams: false },
    });
    sdk = S;
    for (const e of early.splice(0)) S.captureException(e);
  }).catch(() => {});
  const w = window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => void };
  if (w.requestIdleCallback) w.requestIdleCallback(load, { timeout: 4000 }); else setTimeout(load, 2500);
}
