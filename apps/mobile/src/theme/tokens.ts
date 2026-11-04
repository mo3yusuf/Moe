/** CRAVE design tokens — dark-first entertainment surface with an orange-red accent. */
export const colors = {
  bg: '#0A0A0B',
  surface: '#141416',
  surfaceRaised: '#1D1D20',
  border: '#2A2A2E',
  text: '#FFFFFF',
  textMuted: '#A1A1AA',
  // ≥ 4.5:1 on bg (WCAG AA for small text); was #71717A (4.1:1).
  textFaint: '#8E8E98',
  accent: '#FF4D2E',
  accentPressed: '#E63E20',
  accentSoft: 'rgba(255, 77, 46, 0.16)',
  success: '#22C55E',
  danger: '#F43F5E',
  warning: '#F59E0B',
  overlay: 'rgba(0, 0, 0, 0.45)',
  scrim: 'rgba(0, 0, 0, 0.7)',
} as const;

/**
 * Semantic colour scales (lightest → darkest), tuned for a dark UI. Use `soft` for tinted backgrounds,
 * `default` for icons/borders and `lighter` for text on those backgrounds — every text pairing is ≥ 4.5:1.
 */
export const palette = {
  info:    { lightest: '#EAF1FF', lighter: '#9DB8FF', default: '#4C7DFF', darker: '#2F5BD8', darkest: '#1E3A8A', soft: 'rgba(76,125,255,0.14)' },
  success: { lightest: '#E8FAEF', lighter: '#86E0A8', default: '#22C55E', darker: '#15803D', darkest: '#14532D', soft: 'rgba(34,197,94,0.14)' },
  warning: { lightest: '#FFF7E6', lighter: '#FCD37A', default: '#F59E0B', darker: '#B45309', darkest: '#78350F', soft: 'rgba(245,158,11,0.14)' },
  danger:  { lightest: '#FFECEF', lighter: '#FDA4B4', default: '#F43F5E', darker: '#BE123C', darkest: '#881337', soft: 'rgba(244,63,94,0.14)' },
} as const;
export type Tone = keyof typeof palette;

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
