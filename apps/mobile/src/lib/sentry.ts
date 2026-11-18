// Native builds: crash reporting is not wired up yet (needs @sentry/react-native and a native build).
// The web app — what Render hosts today — uses sentry.web.ts.
export function initSentry(): void {}
export function reportError(_error: unknown): void {}
