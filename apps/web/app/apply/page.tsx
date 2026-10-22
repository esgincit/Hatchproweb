import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { ApplyForm } from '@/components/apply/ApplyForm';
import { LanguagePicker } from '@/components/i18n/LanguagePicker';

export default async function Apply() {
  const t = await getTranslations('apply');
  return (
    <main className="screen" style={{ minHeight: '100dvh', paddingTop: 24, paddingBottom: 40 }}>
      <div className="wrap" style={{ maxWidth: 640 }}>
        <div className="row between"><div className="eyebrow">HatchPro</div><LanguagePicker compact /></div>
        <h1 className="h2">{t('title')}</h1>
        <p style={{ color: 'var(--ink2)', margin: 0 }}>{t('intro')}</p>
        <ApplyForm />
        <Link className="back" href="/login">‹ {t('haveAccount')}</Link>
      </div>
    </main>
  );
}
