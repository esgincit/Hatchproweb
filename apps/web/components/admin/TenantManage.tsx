'use client';
// Platform console: change a tenant's plan or status (finance/admin only; DB policy 0016 enforces it too).
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { updateTenant } from '@/app/actions/platform';
import { toast } from '@/components/ui/Toast';

export function TenantManage({ id, name, plan, status }: { id: string; name: string; plan: string; status: string }) {
  const t = useTranslations('admin');
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  if (!open) return <button type="button" className="btn small secondary" style={{ marginTop: 4 }} onClick={() => setOpen(true)}>{t('manage')}</button>;
  return (
    <form className="row wrap" style={{ gap: 6, marginTop: 4, justifyContent: 'flex-end' }}
      onSubmit={(e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        start(async () => {
          const r = await updateTenant(id, String(fd.get('plan')), String(fd.get('status')));
          toast(r.ok ? t('saved', { name }) : r.error);
          if (r.ok) { setOpen(false); router.refresh(); }
        });
      }}>
      <select name="plan" defaultValue={plan} aria-label={t('plan')}>
        {['starter', 'growth', 'pro', 'enterprise'].map((p) => <option key={p} value={p}>{p}</option>)}
      </select>
      <select name="status" defaultValue={status} aria-label={t('status')}>
        {['trial', 'active', 'suspended'].map((s) => <option key={s} value={s}>{t(`st_${s}`)}</option>)}
      </select>
      <button className="btn small" disabled={pending}>{t('save')}</button>
    </form>
  );
}
