'use client';
// Marketplace client pieces (0032): vendor plans + listings, farmer "Contact", marketing review, "+ Advertiser".
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { createClient } from '@/lib/supabase/client';
import { contactListing, deleteListing, reviewListing, saveListing, type Res } from '@/app/actions/marketplace';
import { toast } from '@/components/ui/Toast';

export const CATS = ['feed', 'medicine', 'vaccine', 'equipment', 'chicks', 'transport', 'services', 'other'] as const;
type Listing = { id: string; title: string; category: string; description: string | null; price_text: string | null; area: string | null; status: string; review_note: string | null };
type Plan = { id: string; name: string; price_month: number; max_listings: number };

const fnError = async (e: unknown) => ((await (e as { context?: Response }).context?.json().catch(() => null)) as { error?: string } | null)?.error ?? 'server';

/** Razorpay Checkout (only when ad-checkout says payments are configured). */
function openCheckout(d: { key_id: string; order_id: string; amount: number; name: string; phone: string; plan: string }, done: () => void) {
  const go = () => new (window as unknown as { Razorpay: new (o: Record<string, unknown>) => { open: () => void } }).Razorpay({
    key: d.key_id, order_id: d.order_id, amount: d.amount, currency: 'INR', name: 'HatchPro', description: `Marketplace · ${d.plan}`,
    prefill: { contact: d.phone, name: d.name }, handler: done,
  }).open();
  if ((window as unknown as { Razorpay?: unknown }).Razorpay) return go();
  const s = document.createElement('script');
  s.src = 'https://checkout.razorpay.com/v1/checkout.js'; s.onload = go;
  document.head.appendChild(s);
}

export function VendorPortal({ plans, listings, live }: { plans: Plan[]; listings: Listing[]; live: boolean }) {
  const t = useTranslations('market');
  const router = useRouter();
  const [edit, setEdit] = useState<Partial<Listing> | null>(null);
  const [busy, setBusy] = useState(false);
  const done = (r: Res, ok: string) => { if (!r.ok) return toast(r.error === 'invalid' ? t('invalid') : r.error); toast(ok); setEdit(null); router.refresh(); };

  async function pay(plan: string) {
    setBusy(true);
    const r = await createClient().functions.invoke('ad-checkout', { body: { plan_id: plan } });
    setBusy(false);
    if (r.error) return toast(t('payFailed', { error: await fnError(r.error) }));
    if (!r.data.configured) return toast(t('payNotSetUp'));
    openCheckout(r.data, () => { toast(t('paid')); setTimeout(() => router.refresh(), 3000); });
  }

  async function save(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = Object.fromEntries([...new FormData(e.currentTarget).entries()].map(([k, v]) => [k, String(v).trim() || undefined]));
    setBusy(true);
    const r = await saveListing({ ...fd, id: edit?.id });
    setBusy(false);
    done(r, t('saved'));
  }

  return (
    <>
      <div className="card" data-testid="plans">
        <div className="eyebrow" style={{ marginBottom: 6 }}>{t('plans')}</div>
        <div className="list">{plans.map((p) => (
          <div className="item" key={p.id}>
            <div><div className="t">{p.name}</div><div className="s">{t('planLine', { price: p.price_month.toLocaleString('en-IN'), n: p.max_listings })}</div></div>
            <div className="r"><button className="btn small" disabled={busy} onClick={() => pay(p.id)}>{t('pay', { price: p.price_month.toLocaleString('en-IN') })}</button></div>
          </div>
        ))}</div>
      </div>
      <div className="card" data-testid="listings">
        <div className="row between" style={{ marginBottom: 6 }}>
          <div className="eyebrow">{t('myListings')}</div>
          {!edit && <button className="btn small" onClick={() => setEdit({ category: 'feed' })}>{t('add')}</button>}
        </div>
        {edit && (
          <form onSubmit={save} style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 10 }}>
            <div className="field"><label htmlFor="l_title">{t('title')}</label><input id="l_title" name="title" defaultValue={edit.title ?? ''} required /></div>
            <div className="field"><label htmlFor="l_cat">{t('category')}</label>
              <select id="l_cat" name="category" defaultValue={edit.category ?? 'feed'}>{CATS.map((c) => <option key={c} value={c}>{t(`cat.${c}`)}</option>)}</select></div>
            <div className="field"><label htmlFor="l_price">{t('price')}</label><input id="l_price" name="price_text" defaultValue={edit.price_text ?? ''} /></div>
            <div className="field"><label htmlFor="l_area">{t('area')}</label><input id="l_area" name="area" defaultValue={edit.area ?? ''} /></div>
            <div className="field"><label htmlFor="l_desc">{t('description')}</label><textarea id="l_desc" name="description" defaultValue={edit.description ?? ''} rows={3} /></div>
            <div className="row" style={{ gap: 8 }}>
              <button className="btn" type="submit" disabled={busy}>{t('submitReview')}</button>
              <button className="btn secondary" type="button" onClick={() => setEdit(null)}>{t('cancel')}</button>
            </div>
          </form>
        )}
        <div className="list">{listings.map((l) => (
          <div className="item" key={l.id}>
            <div><div className="t">{l.title}</div><div className="s">{t(`cat.${l.category}`)}{l.price_text ? ` · ${l.price_text}` : ''}{l.review_note ? ` · ${l.review_note}` : ''}</div></div>
            <div className="r" style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
              <span className={`pill ${l.status === 'approved' && live ? 'good' : l.status === 'rejected' ? 'crit' : 'warn'}`}>{l.status === 'approved' && !live ? t('st_approvedWait') : t(`st.${l.status}`)}</span>
              <button className="btn small secondary" onClick={() => setEdit(l)}>{t('edit')}</button>
              <button className="btn small secondary" onClick={async () => done(await deleteListing(l.id), t('deleted'))}>{t('delete')}</button>
            </div>
          </div>
        ))}{!listings.length && <div className="s">{t('noListings')}</div>}</div>
      </div>
    </>
  );
}

export function ContactButton({ id }: { id: string }) {
  const t = useTranslations('market');
  const [phone, setPhone] = useState<string | null>(null);
  if (phone) {
    const digits = phone.replace(/\D/g, '');
    return <span className="row" style={{ gap: 6 }}><a className="btn small" href={`tel:${phone.replace(/\s/g, '')}`}>{t('call')}</a><a className="btn small secondary" href={`https://wa.me/${digits}`} target="_blank" rel="noreferrer">WhatsApp</a></span>;
  }
  return <button className="btn small" onClick={async () => { const r = await contactListing(id); if (r.ok) { setPhone(r.phone ?? ''); toast(t('leadSent')); } else toast(r.error); }}>{t('contact')}</button>;
}

export function ReviewButtons({ id }: { id: string }) {
  const t = useTranslations('market');
  const router = useRouter();
  const [note, setNote] = useState('');
  const act = async (ok: boolean) => { const r = await reviewListing(id, ok, ok ? undefined : note.trim() || undefined); if (!r.ok) return toast(r.error); toast(ok ? t('approved') : t('rejected')); router.refresh(); };
  return (
    <span className="row wrap" style={{ gap: 6 }}>
      <input value={note} maxLength={300} onChange={(e) => setNote(e.target.value)} aria-label={t('rejectNote')} placeholder={t('rejectNote')} style={{ flex: '1 1 200px' }} />
      <button className="btn small" onClick={() => act(true)}>{t('approve')}</button><button className="btn small secondary" onClick={() => act(false)}>{t('reject')}</button>
    </span>
  );
}

export function InviteVendor() {
  const t = useTranslations('market');
  const router = useRouter();
  const [open, setOpen] = useState(false);
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const body = Object.fromEntries([...new FormData(e.currentTarget).entries()].map(([k, v]) => [k, String(v)]));
    const r = await createClient().functions.invoke('invite-vendor', { body });
    if (r.error) {
      const code = await fnError(r.error); // the function answers with a short code; show it in the user's language
      return toast(t('inviteFailed', { error: t.has(`err_${code}`) ? t(`err_${code}`) : code }));
    }
    toast(t('invited', { name: body.business_name })); setOpen(false); router.refresh();
  }
  if (!open) return <button className="btn small" onClick={() => setOpen(true)}>{t('addAdvertiser')}</button>;
  return (
    <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 8, width: '100%' }}>
      <div className="field"><label htmlFor="v_name">{t('business')}</label><input id="v_name" name="business_name" required /></div>
      <div className="field"><label htmlFor="v_phone">{t('phone')}</label><input id="v_phone" name="phone" type="tel" required /></div>
      <div className="field"><label htmlFor="v_cat">{t('category')}</label><select id="v_cat" name="category">{CATS.map((c) => <option key={c} value={c}>{t(`cat.${c}`)}</option>)}</select></div>
      <div className="field"><label htmlFor="v_dist">{t('district')}</label><input id="v_dist" name="district" /></div>
      <button className="btn" type="submit">{t('invite')}</button>
    </form>
  );
}
