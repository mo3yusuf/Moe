import type { MetadataRoute } from 'next';

/** "Add to home screen": the dashboard opens full-screen like an app (handy on the counter tablet). */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'CRAVE for Business',
    short_name: 'CRAVE Biz',
    description: 'Take CRAVE orders, manage your menu and see your sales.',
    start_url: '/restaurant',
    display: 'standalone',
    background_color: '#0a0a0b',
    theme_color: '#0a0a0b',
    icons: [
      { src: '/icon', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/apple-icon', sizes: '180x180', type: 'image/png' },
    ],
  };
}
