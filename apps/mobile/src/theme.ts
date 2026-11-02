/** CRAVE design tokens — dark, premium, red-orange accent. */
export const colors = {
  bg: '#0A0A0A',
  surface: '#141414',
  surfaceRaised: '#1E1E1E',
  border: '#2A2A2A',
  text: '#FFFFFF',
  textMuted: '#A1A1A1',
  textDim: '#6B6B6B',
  accent: '#FF4D1F',
  accentPressed: '#E03E12',
  accentSoft: 'rgba(255, 77, 31, 0.16)',
  success: '#22C55E',
  danger: '#F04438',
  overlay: 'rgba(0, 0, 0, 0.45)',
  scrimTop: 'rgba(0,0,0,0.55)',
  scrimBottom: 'rgba(0,0,0,0.85)',
} as const;

export const radius = { sm: 8, md: 14, lg: 20, pill: 999 } as const;
export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;

export const type = {
  display: { fontSize: 32, fontWeight: '800' as const, letterSpacing: -0.5 },
  title: { fontSize: 22, fontWeight: '700' as const, letterSpacing: -0.2 },
  heading: { fontSize: 17, fontWeight: '700' as const },
  body: { fontSize: 15, fontWeight: '400' as const, lineHeight: 21 },
  bodyStrong: { fontSize: 15, fontWeight: '600' as const },
  caption: { fontSize: 13, fontWeight: '400' as const },
  label: { fontSize: 12, fontWeight: '700' as const, letterSpacing: 0.6, textTransform: 'uppercase' as const },
  price: { fontSize: 18, fontWeight: '800' as const },
};
