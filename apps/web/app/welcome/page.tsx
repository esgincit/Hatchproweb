import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { createClient } from '@/lib/supabase/server';
import { FarmTypePicker } from '@/components/auth/FarmTypePicker';
import { LanguagePicker } from '@/components/i18n/LanguagePicker';
import { pickerOptions, type FarmType } from '@/lib/farm-types';

export default async function Welcome() {
  const t = await getTranslations('auth');
  const sb = await createClient();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) redirect('/login');
  const [{ data: me }, { data: farms }] = await Promise.all([
    sb.from('app_user').select('full_name').eq('id', user.id).maybeSingle(),
    sb.from('farm').select('farm_type'),
  ]);
  const types = [...new Set((farms ?? []).map((f) => f.farm_type as FarmType))];
  const first = me?.full_name?.split(' ')[0];
  return (
    <main className="screen" style={{ minHeight: '100dvh', paddingTop: '12vh' }}>
      <div className="wrap" style={{ maxWidth: 560 }}>
        <div className="row between"><div className="eyebrow">{first ? t('welcomeName', { name: first }) : t('welcome')}</div><LanguagePicker compact /></div>
        <h1 className="h2">{t('whatManage')}</h1>
        <p style={{ color: 'var(--ink2)', margin: 0 }}>{t('switchAnyTime')}</p>
        <FarmTypePicker options={pickerOptions(types)} />
      </div>
    </main>
  );
}
