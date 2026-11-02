/** CRAVE design tokens — dark-first entertainment surface with an orange-red accent. */
export const colors = {
  bg: '#0A0A0B',
  surface: '#141416',
  surfaceRaised: '#1D1D20',
  border: '#2A2A2E',
  text: '#FFFFFF',
  textMuted: '#A1A1AA',
  textFaint: '#71717A',
  accent: '#FF4D2E',
  accentPressed: '#E63E20',
  accentSoft: 'rgba(255, 77, 46, 0.16)',
  success: '#22C55E',
  danger: '#F43F5E',
  warning: '#F59E0B',
  overlay: 'rgba(0, 0, 0, 0.45)',
  scrim: 'rgba(0, 0, 0, 0.7)',
} as const;

export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;
export const radius = { sm: 8, md: 12, lg: 16, pill: 999 } as const;
export const font = {
  display: { fontSize: 32, fontWeight: '800' as const, letterSpacing: -0.5 },
  title: { fontSize: 22, fontWeight: '700' as const },
  heading: { fontSize: 17, fontWeight: '700' as const },
  body: { fontSize: 15, fontWeight: '400' as const },
  small: { fontSize: 13, fontWeight: '400' as const },
  label: { fontSize: 12, fontWeight: '600' as const, letterSpacing: 0.4 },
} as const;

/** Minimum touch target (Apple HIG 44pt / Material 48dp). */
export const HIT = 48;
