'use server';
import { cookies } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { LOCALES, LOCALE_COOKIE, type Locale } from '@/lib/i18n/locales';

const YEAR = 60 * 60 * 24 * 365;

/** Device choice (cookie) + saved to the profile so the next phone this user logs into starts in it. */
export async function setLocale(locale: Locale) {
  if (!LOCALES.includes(locale)) throw new Error('Unsupported language');
  (await cookies()).set(LOCALE_COOKIE, locale, { path: '/', maxAge: YEAR, sameSite: 'lax' });
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (user) await sb.from('app_user').update({ language: locale }).eq('id', user.id);
  revalidatePath('/', 'layout');
}

/** After login: adopt the profile language unless this device already chose one. */
export async function applyProfileLocale() {
  const jar = await cookies();
  if (jar.get(LOCALE_COOKIE)) return;
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return;
  const { data } = await sb.from('app_user').select('language').eq('id', user.id).maybeSingle();
  if (data?.language && LOCALES.includes(data.language as Locale)) jar.set(LOCALE_COOKIE, data.language, { path: '/', maxAge: YEAR, sameSite: 'lax' });
}
