import { getRequestConfig } from 'next-intl/server';
import { cookies, headers } from 'next/headers';
import { LOCALE_COOKIE, pickLocale } from '@/lib/i18n/locales';

// No locale in the URL: the choice lives in a cookie (set from the language picker / the user's profile).
export default getRequestConfig(async () => {
  const locale = pickLocale((await cookies()).get(LOCALE_COOKIE)?.value, (await headers()).get('accept-language'));
  return { locale, messages: (await import(`../messages/${locale}.json`)).default, timeZone: 'Asia/Kolkata' };
});
