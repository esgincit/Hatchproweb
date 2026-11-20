'use client';
import { useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { submitPortalPayment } from '@/app/actions/portal';
import { toast } from '@/components/ui/Toast';
import { createClient } from '@/lib/supabase/client';
import { PROOF_EXT, PROOF_MAX_BYTES } from '@/lib/schemas';

/** Payment reference (+ optional proof file) for one order. The proof goes to <tenant>/payment/<order id>/<uuid>.<ext> with the customer's own login
 *  (0061 storage policy: only their own open orders). A refusal shows under the field; on success the order leaves this list, so a toast confirms it. */
export function PortalPay({ orderNo, orderId, tenantId }: { orderNo: string; orderId: string; tenantId: string }) {
  const t = useTranslations('portal');
  const [ref, setRef] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, go] = useTransition();
  async function send(file: File | null) {
    let path: string | null = null;
    if (ref.trim().length < 4) return setMsg({ ok: false, text: t('refBad') }); // before uploading anything
    if (file) {
      const ext = PROOF_EXT[file.type as keyof typeof PROOF_EXT];
      if (!ext || file.size > PROOF_MAX_BYTES) return setMsg({ ok: false, text: t('proofBad') });
      path = `${tenantId}/payment/${orderId}/${crypto.randomUUID()}.${ext}`;
      const up = await createClient().storage.from('evidence').upload(path, file, { contentType: file.type });
      if (up.error) return setMsg({ ok: false, text: t('proofFailed', { err: up.error.message }) });
    }
    const r = await submitPortalPayment(orderNo, ref, path);
    if (r.ok) { setRef(''); setMsg(null); toast(r.msg); } else setMsg({ ok: false, text: r.msg });
  }
  return (
    <form className="row" style={{ gap: 6, flexWrap: 'wrap', marginTop: 6 }} data-testid="pay-form" data-no={orderNo}
      onSubmit={(e) => { e.preventDefault(); const f = (e.currentTarget.elements.namedItem('proof') as HTMLInputElement).files?.[0] ?? null; go(() => send(f)); }}>
      <input aria-label={t('payRef', { no: orderNo })} value={ref} onChange={(e) => setRef(e.target.value)} placeholder={t('payRefHint')} maxLength={60} style={{ flex: 1, minWidth: 140 }} />
      <input name="proof" type="file" accept="image/jpeg,image/png,image/webp,application/pdf" aria-label={t('proofLabel', { no: orderNo })} style={{ flexBasis: '100%' }} />
      <button className="btn small" type="submit" disabled={busy}>{t('paySend')}</button>
      {msg && <div className="pill crit" role="status" style={{ whiteSpace: 'normal', flexBasis: '100%' }}>{msg.text}</div>}
    </form>
  );
}
