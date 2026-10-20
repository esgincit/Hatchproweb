import type { Metadata, Viewport } from 'next';
import { Manrope, IBM_Plex_Sans, Noto_Sans_Telugu } from 'next/font/google';
import './globals.css';

const manrope = Manrope({ subsets: ['latin'], weight: ['500', '600', '700', '800'], variable: '--font-manrope' });
const plex = IBM_Plex_Sans({ subsets: ['latin'], weight: ['400', '500', '600'], variable: '--font-plex' });
const telugu = Noto_Sans_Telugu({ subsets: ['telugu'], weight: ['500'], variable: '--font-telugu' });

export const metadata: Metadata = { title: 'HatchPro', description: 'Poultry farm operations — layer, broiler, hatchery' };
export const viewport: Viewport = { width: 'device-width', initialScale: 1, viewportFit: 'cover' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${manrope.variable} ${plex.variable} ${telugu.variable}`}>
      <body>{children}</body>
    </html>
  );
}
