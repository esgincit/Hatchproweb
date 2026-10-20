import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { FarmTypePicker } from '@/components/auth/FarmTypePicker';
import { pickerOptions, type FarmType } from '@/lib/farm-types';

export default async function Welcome() {
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
  return (
    <main className="screen" style={{ minHeight: '100dvh', paddingTop: '12vh' }}>
      <div className="wrap" style={{ maxWidth: 560 }}>
        <div className="eyebrow">Welcome{me?.full_name ? `, ${me.full_name.split(' ')[0]}` : ''}</div>
        <h1 className="h2">What do you want to manage now?</h1>
        <p style={{ color: 'var(--ink2)', margin: 0 }}>You can switch any time from the farm name at the top.</p>
        <FarmTypePicker options={pickerOptions(types)} />
      </div>
    </main>
  );
}
