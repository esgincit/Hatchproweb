import type { Metadata, Viewport } from 'next';
import { Manrope, IBM_Plex_Sans, Noto_Sans_Telugu, Noto_Sans_Devanagari, Noto_Sans_Tamil, Noto_Sans_Kannada } from 'next/font/google';
import { NextIntlClientProvider } from 'next-intl';
import { getLocale } from 'next-intl/server';
import './globals.css';

const manrope = Manrope({ subsets: ['latin'], weight: ['500', '600', '700', '800'], variable: '--font-manrope' });
const plex = IBM_Plex_Sans({ subsets: ['latin'], weight: ['400', '500', '600'], variable: '--font-plex' });
// Indic scripts: variable fonts split by unicode-range, so a browser only downloads the script it actually renders.
const telugu = Noto_Sans_Telugu({ subsets: ['telugu'], variable: '--font-telugu' });
const deva = Noto_Sans_Devanagari({ subsets: ['devanagari'], variable: '--font-deva' });
const tamil = Noto_Sans_Tamil({ subsets: ['tamil'], variable: '--font-tamil' });
const kannada = Noto_Sans_Kannada({ subsets: ['kannada'], variable: '--font-kannada' });

export const metadata: Metadata = {
  title: 'HatchPro', description: 'Poultry farm operations — layer, broiler, hatchery',
  icons: { icon: '/icon.svg', apple: '/apple-touch-icon.png' }, appleWebApp: { capable: true, title: 'HatchPro' },
};
export const viewport: Viewport = {
  width: 'device-width', initialScale: 1, viewportFit: 'cover',
  themeColor: [{ media: '(prefers-color-scheme: light)', color: '#f3efe6' }, { media: '(prefers-color-scheme: dark)', color: '#17130d' }],
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const locale = await getLocale();
  const fonts = [manrope, plex, telugu, deva, tamil, kannada].map((f) => f.variable).join(' ');
  return (
    <html lang={locale} className={fonts}>
      <body>
        <NextIntlClientProvider>{children}</NextIntlClientProvider>
      </body>
    </html>
  );
}
