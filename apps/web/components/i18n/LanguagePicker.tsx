'use client';
import { useLocale, useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import { setLocale } from '@/app/actions/locale';
import { LOCALES, LOCALE_NAMES, type Locale } from '@/lib/i18n/locales';

export function LanguagePicker({ compact = false }: { compact?: boolean }) {
  const locale = useLocale();
  const t = useTranslations('common');
  const router = useRouter();
  const [pending, start] = useTransition();
  const select = (
    <select id="lang" aria-label={t('language')} value={locale} disabled={pending}
      onChange={(e) => start(async () => { await setLocale(e.target.value as Locale); router.refresh(); })}
      style={compact ? { font: 'inherit', fontSize: 13, padding: '6px 8px', borderRadius: 10, border: '1px solid var(--line)', background: 'var(--surface2)', color: 'var(--ink)' } : undefined}>
      {LOCALES.map((l) => <option key={l} value={l}>{LOCALE_NAMES[l]}</option>)}
    </select>
  );
  return compact ? select : <div className="field"><label htmlFor="lang">{t('language')}</label>{select}</div>;
}
