import type { ReactNode } from 'react';

/**
 * Web build (used only for the demo preview): the Stripe React Native SDK has no web implementation,
 * so card payment is unavailable here. Ordering on web is disabled anyway (demo mode).
 */
export function StripeProvider({ children }: { children: ReactNode; publishableKey?: string; merchantIdentifier?: string; urlScheme?: string }) {
  return <>{children}</>;
}

const unavailable = async () => ({ error: { code: 'Failed', message: 'Card payments are only available in the iOS and Android apps.' } });
export function useStripe() {
  return { initPaymentSheet: unavailable, presentPaymentSheet: unavailable };
}
