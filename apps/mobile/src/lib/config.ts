/**
 * Public runtime configuration. EXPO_PUBLIC_* values are compiled into the app bundle and are
 * visible to anyone — only the Supabase anon key (protected by RLS) belongs here.
 */
import { publicBaseUrl } from '@crave/core';

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL ?? '';
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '';
const stripePublishableKey = process.env.EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY ?? '';
const orderingEnabled = process.env.EXPO_PUBLIC_ORDERING_ENABLED === 'true';
// Hosting platforms may provide a bare (or private) host name; publicBaseUrl makes it reachable.
const apiUrl = publicBaseUrl(process.env.EXPO_PUBLIC_API_URL);

export const config = {
  supabaseUrl,
  supabaseAnonKey,
  apiUrl,
  /** Publishable key only (pk_...). Card payments are disabled when absent. Updated by loadRuntimeConfig. */
  stripePublishableKey,
  /** Ordering switch: "Order" buttons say "coming soon" while off. Updated by loadRuntimeConfig. */
  orderingEnabled,
  /**
   * Demo mode: no backend configured. The app runs on bundled demonstration data, sign-in is
   * skipped and ordering/payments are disabled. Always shown to the user with a visible banner.
   */
  demoMode: !supabaseUrl || !supabaseAnonKey || !apiUrl,
};

interface RuntimeConfig { orderingEnabled: boolean; stripePublishableKey: string | null }
const RUNTIME_KEY = 'crave.appConfig.v1';
try {
  const cached = !config.demoMode && typeof localStorage !== 'undefined' ? localStorage.getItem(RUNTIME_KEY) : null;
  if (cached) Object.assign(config, pick(JSON.parse(cached)));
} catch { /* storage unavailable: use built-in values */ }

function pick(r: Partial<RuntimeConfig>) {
  return { orderingEnabled: r.orderingEnabled === true, stripePublishableKey: typeof r.stripePublishableKey === 'string' ? r.stripePublishableKey : '' };
}

function apply(r: RuntimeConfig) { Object.assign(config, pick(r)); }

/**
 * Ordering and payments are switched on from the API's settings (GET /app-config), so turning
 * ordering on never needs an app rebuild. Never blocks start-up: the last answer (remembered on this
 * device) applies immediately, and a fresh one is fetched in the background.
 */
export async function loadRuntimeConfig(): Promise<void> {
  if (config.demoMode) return;
  try {
    const res = await fetch(`${apiUrl}/app-config`, { signal: AbortSignal.timeout(60_000) });
    if (!res.ok) return;
    const r = (await res.json()) as RuntimeConfig;
    apply(r);
    try { if (typeof localStorage !== 'undefined') localStorage.setItem(RUNTIME_KEY, JSON.stringify(r)); } catch { /* ignore */ }
  } catch { /* offline or server asleep: keep the remembered value */ }
}

// Web: warm up connections to the API and Supabase as soon as the app script runs.
if (typeof document !== 'undefined') {
  for (const href of [apiUrl, supabaseUrl]) {
    if (!href || !/^https:/.test(href)) continue;
    const l = document.createElement('link');
    l.rel = 'preconnect'; l.href = new URL(href).origin; l.crossOrigin = 'anonymous';
    document.head.appendChild(l);
  }
}
