// Vendor (marketplace advertiser) portal — 0032. Plan status + pay, listings (reviewed by the platform before farmers see
// them), and leads from farmers. Route guard keeps vendors here and everyone else out.
import { redirect } from 'next/navigation';
import { getLocale, getTranslations } from 'next-intl/server';
import { createClient } from '@/lib/supabase/server';
import { Header } from '@/components/ui/bits';
import { Toaster } from '@/components/ui/Toast';
import { SignOutButton } from '@/components/shell/SignOutButton';
import { LanguagePicker } from '@/components/i18n/LanguagePicker';
import { VendorPortal } from '@/components/marketplace/Market';
import { dateFmt } from '@/lib/format';

export default async function Vendor() {
  const [t, locale, sb] = await Promise.all([getTranslations('market'), getLocale(), createClient()]);
  const dmy = dateFmt(locale);
  const { data: { user } } = await sb.auth.getUser();
  if (!user) redirect('/login');
  const { data: adv } = await sb.from('advertiser').select('id,business_name,category,status').eq('user_id', user.id).maybeSingle();
  if (!adv) return <main className="screen"><div className="wrap"><div className="card">{t('notVendor')}</div><SignOutButton /></div></main>;

  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
  const [{ data: plans }, { data: subs }, { data: listings }, { data: leads }] = await Promise.all([
    sb.from('ad_plan').select('id,name,price_month,max_listings').eq('active', true).order('price_month'),
    sb.from('ad_subscription').select('plan_id,status,starts_on,ends_on').eq('advertiser_id', adv.id).eq('status', 'active').order('ends_on', { ascending: false }),
    sb.from('product_listing').select('id,title,category,description,price_text,area,status,review_note').eq('advertiser_id', adv.id).order('created_at', { ascending: false }),
    sb.from('listing_lead').select('id,contact_name,contact_phone,message,created_at,product_listing(title)').order('created_at', { ascending: false }).limit(50),
  ]);
  const live = (subs ?? []).find((s) => s.starts_on <= today && s.ends_on >= today);

  return (
    <div className="app"><div className="col">
      <header className="topbar"><div className="tenant"><span className="avatar">🛒</span><span><div className="name">{adv.business_name}</div><div className="sub">{t('portal')}</div></span></div><LanguagePicker compact /></header>
      <main className="screen"><div className="wrap">
        <Header title={t('portal')} />
        <div className={`card stripe ${live ? 'good' : 'warn'}`} data-testid="plan-status">
          {adv.status !== 'active' ? t('suspended') : live ? t('liveUntil', { date: dmy(live.ends_on) }) : t('notLive')}
        </div>
        <VendorPortal plans={(plans ?? []).map((p) => ({ ...p, price_month: Number(p.price_month) }))} listings={listings ?? []} live={!!live && adv.status === 'active'} />
        <div className="card" data-testid="leads"><div className="eyebrow" style={{ marginBottom: 6 }}>{t('leads')}</div><div className="list">
          {(leads ?? []).map((l) => (
            <div className="item" key={l.id}><div>
              <div className="t">{l.contact_name ?? '—'} · {l.contact_phone ?? ''}</div>
              <div className="s">{(Array.isArray(l.product_listing) ? l.product_listing[0] : l.product_listing)?.title} · {dmy(l.created_at.slice(0, 10))}{l.message ? ` · ${l.message}` : ''}</div>
            </div></div>
          ))}
          {!leads?.length && <div className="s">{t('noLeads')}</div>}
        </div></div>
        <SignOutButton />
      </div></main>
      <Toaster />
    </div></div>
  );
}
