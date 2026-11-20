'use client';
import { useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { submitPortalPayment } from '@/app/actions/portal';
import { toast } from '@/components/ui/Toast';

/** Payment reference for one order. A refusal shows under the field; on success the order leaves this list, so a toast confirms it. */
export function PortalPay({ orderNo }: { orderNo: string }) {
  const t = useTranslations('portal');
  const [ref, setRef] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, go] = useTransition();
  return (
    <form className="row" style={{ gap: 6, flexWrap: 'wrap', marginTop: 6 }} data-testid="pay-form" data-no={orderNo}
      onSubmit={(e) => { e.preventDefault(); go(async () => { const r = await submitPortalPayment(orderNo, ref); if (r.ok) { setRef(''); toast(r.msg); } else setMsg({ ok: false, text: r.msg }); }); }}>
      <input aria-label={t('payRef', { no: orderNo })} value={ref} onChange={(e) => setRef(e.target.value)} placeholder={t('payRefHint')} maxLength={60} style={{ flex: 1, minWidth: 140 }} />
      <button className="btn small" type="submit" disabled={busy}>{t('paySend')}</button>
      {msg && <div className="pill crit" role="status" style={{ whiteSpace: 'normal', flexBasis: '100%' }}>{msg.text}</div>}
    </form>
  );
}
