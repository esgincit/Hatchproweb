// Web app manifest: lets phones "Add to Home Screen" (required for push on iPhone, iOS 16.4+).
// ponytail: no icons yet — add 192/512 px PNGs in Phase 13 (PWA/Lighthouse pass).
import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'HatchPro', short_name: 'HatchPro', start_url: '/home', display: 'standalone',
    background_color: '#f3efe6', theme_color: '#f3efe6',
  };
}
