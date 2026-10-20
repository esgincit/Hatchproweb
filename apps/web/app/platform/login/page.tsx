import { getTranslations } from 'next-intl/server';
import { OtpLogin } from '@/components/auth/OtpLogin';
import { LanguagePicker } from '@/components/i18n/LanguagePicker';

export default async function PlatformLogin() {
  const t = await getTranslations('auth');
  return (
    <main className="screen" style={{ minHeight: '100dvh', paddingTop: '12vh' }}>
      <div className="wrap" style={{ maxWidth: 420 }}>
        <div className="row between"><div className="eyebrow">HatchPro · {t('staff')}</div><LanguagePicker compact /></div>
        <h1 className="h2">{t('platformConsole')}</h1>
        <p style={{ color: 'var(--ink2)', margin: 0 }}>{t('staffWho')}</p>
        <OtpLogin portal="platform" />
      </div>
    </main>
  );
}
