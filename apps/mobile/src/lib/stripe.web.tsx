import { Elements, PaymentElement, useElements, useStripe as useStripeJs } from '@stripe/react-stripe-js';
import { loadStripe, type Stripe } from '@stripe/stripe-js';
import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, Text, View } from 'react-native';
import { config } from '@/lib/config';
import { colors, font, radius, space } from '@/theme/tokens';

/**
 * Web (the app as hosted on Render): Stripe's Payment Element in a bottom sheet. It offers cards,
 * Apple Pay and Google Pay (where the browser supports them). Card details go straight to Stripe in
 * Stripe's own secure frame and never touch CRAVE. Same interface as the native PaymentSheet, so the
 * basket screen works unchanged on both.
 */
type Result = { error?: { code: string; message: string } };
interface InitParams { paymentIntentClientSecret: string; returnURL?: string; [k: string]: unknown }
interface Ctx { initPaymentSheet(p: InitParams): Promise<Result>; presentPaymentSheet(): Promise<Result> }

const StripeCtx = createContext<Ctx | null>(null);
let stripePromise: Promise<Stripe | null> | null = null;
let stripeKey = '';

export function StripeProvider({ children, publishableKey }: { children: ReactNode; publishableKey?: string; merchantIdentifier?: string; urlScheme?: string }) {
  const [secret, setSecret] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const resolver = useRef<((r: Result) => void) | null>(null);

  const initPaymentSheet = useCallback(async (p: InitParams): Promise<Result> => {
    // Read at payment time: the key can arrive from the server after the app has started.
    const key = config.stripePublishableKey || publishableKey;
    if (!key) return { error: { code: 'Failed', message: 'Card payments are not configured in this build.' } };
    if (!stripePromise || stripeKey !== key) { stripeKey = key; stripePromise = loadStripe(key); }
    setSecret(p.paymentIntentClientSecret);
    return {};
  }, [publishableKey]);

  const presentPaymentSheet = useCallback(() => new Promise<Result>((resolve) => {
    resolver.current = resolve;
    setOpen(true);
  }), []);

  const finish = useCallback((r: Result) => {
    setOpen(false);
    resolver.current?.(r);
    resolver.current = null;
  }, []);

  const value = useMemo(() => ({ initPaymentSheet, presentPaymentSheet }), [initPaymentSheet, presentPaymentSheet]);
  return (
    <StripeCtx.Provider value={value}>
      {children}
      <Modal visible={open && !!secret} transparent animationType="slide" onRequestClose={() => finish({ error: { code: 'Canceled', message: 'Payment cancelled' } })}>
        <View style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.6)' }}>
          <View style={{ backgroundColor: colors.surface, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, maxHeight: '92%', width: '100%', maxWidth: 560, alignSelf: 'center' }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: space.lg, paddingBottom: space.sm }}>
              <Text style={[font.heading, { color: colors.text }]}>Pay securely</Text>
              <Pressable accessibilityRole="button" accessibilityLabel="Cancel payment" hitSlop={12}
                onPress={() => finish({ error: { code: 'Canceled', message: 'Payment cancelled' } })}>
                <Text style={[font.body, { color: colors.textMuted }]}>Cancel</Text>
              </Pressable>
            </View>
            <ScrollView contentContainerStyle={{ padding: space.lg, paddingTop: 0 }}>
              {secret && stripePromise ? (
                <Elements stripe={stripePromise} options={{
                  clientSecret: secret,
                  appearance: { theme: 'night', variables: { colorPrimary: colors.accent, colorBackground: colors.surface, borderRadius: '12px' } },
                }}>
                  <PayForm onDone={finish} />
                </Elements>
              ) : null}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </StripeCtx.Provider>
  );
}

function PayForm({ onDone }: { onDone(r: Result): void }) {
  const stripe = useStripeJs();
  const elements = useElements();
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function pay() {
    if (!stripe || !elements) return;
    setBusy(true);
    setMessage(null);
    const { error } = await stripe.confirmPayment({
      elements,
      // Only used by payment methods that must leave the page (most cards and wallets don't).
      confirmParams: { return_url: `${window.location.origin}/orders` },
      redirect: 'if_required',
    });
    setBusy(false);
    if (error) {
      // Declines and validation errors stay in the sheet so the customer can fix them and retry.
      setMessage(error.message ?? 'Your payment didn’t go through. Please try another card.');
      return;
    }
    onDone({});
  }

  return (
    <View style={{ gap: space.lg }}>
      <PaymentElement onReady={() => setReady(true)} options={{ layout: 'tabs', wallets: { applePay: 'auto', googlePay: 'auto' } }} />
      {!ready ? <ActivityIndicator color={colors.accent} /> : null}
      {message ? <Text style={[font.small, { color: colors.danger }]} accessibilityLiveRegion="polite">{message}</Text> : null}
      <Pressable accessibilityRole="button" disabled={!ready || busy} onPress={pay}
        style={({ pressed }) => ({ backgroundColor: pressed ? colors.accentPressed : colors.accent, opacity: !ready || busy ? 0.6 : 1, borderRadius: 999, paddingVertical: 16, alignItems: 'center' })}>
        {busy ? <ActivityIndicator color="#fff" /> : <Text style={[font.heading, { color: '#fff' }]}>Pay now</Text>}
      </Pressable>
      <Text style={[font.small, { color: colors.textMuted, textAlign: 'center' }]}>Payments are processed by Stripe. CRAVE never sees your card details.</Text>
    </View>
  );
}

export function useStripe(): Ctx {
  const ctx = useContext(StripeCtx);
  if (!ctx) throw new Error('useStripe must be used inside StripeProvider');
  return ctx;
}
