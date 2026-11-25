import { ImageResponse } from 'next/og';

export const size = { width: 512, height: 512 };
export const contentType = 'image/png';

/** App icon: the CRAVE flame mark on brand orange (generated, no image files needed). */
export default function Icon() {
  return new ImageResponse(
    <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#ff4d2e', color: '#fff', fontSize: 300, fontWeight: 900, fontFamily: 'sans-serif' }}>C</div>,
    size,
  );
}
