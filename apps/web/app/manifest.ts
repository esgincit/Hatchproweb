// Web app manifest: lets phones "Add to Home Screen" (required for push on iPhone, iOS 16.4+).
// Icons are rendered from public/icon.svg by scripts/make-icons.mjs.
import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'HatchPro', short_name: 'HatchPro', start_url: '/home', display: 'standalone',
    background_color: '#f3efe6', theme_color: '#e2900f',
    icons: [
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
      { src: '/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
      { src: '/icon.svg', sizes: 'any', type: 'image/svg+xml' },
    ],
  };
}
