import { getTranslations } from 'next-intl/server';
import { OtpLogin } from '@/components/auth/OtpLogin';
import { LanguagePicker } from '@/components/i18n/LanguagePicker';

export default async function Login({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  const t = await getTranslations('auth');
  return (
    <main className="screen" style={{ minHeight: '100dvh', paddingTop: '12vh' }}>
      <div className="wrap" style={{ maxWidth: 420 }}>
        <div className="row between"><div className="eyebrow">HatchPro</div><LanguagePicker compact /></div>
        <h1 className="h2">{t('signInFarm')}</h1>
        <p style={{ color: 'var(--ink2)', margin: 0 }}>{t('farmWho')}</p>
        {error === 'no-access' && <div className="pill warn" style={{ whiteSpace: 'normal' }}>{t('noRole')}</div>}
        <OtpLogin portal="farm" />
      </div>
    </main>
  );
}
