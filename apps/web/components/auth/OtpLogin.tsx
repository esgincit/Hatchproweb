'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { createClient } from '@/lib/supabase/client';
import { claimsFromUser } from '@/lib/auth/claims';
import { landingFor } from '@/lib/auth/route-guard';
import { applyProfileLocale } from '@/app/actions/locale';

export function OtpLogin({ portal }: { portal: 'farm' | 'platform' }) {
  const t = useTranslations('auth');
  const router = useRouter();
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const e164 = '+91' + phone.replace(/\D/g, '').slice(-10);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    // shouldCreateUser:false + enable_signup=false in Auth: accounts exist only after platform approval
    const { error } = await createClient().auth.signInWithOtp({ phone: e164, options: { shouldCreateUser: false } });
    setBusy(false);
    if (error) return setErr(/signups? not allowed/i.test(error.message) ? t('noAccount') : error.message);
    setSent(true);
  }

  async function verify(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    const sb = createClient();
    const { data, error } = await sb.auth.verifyOtp({ phone: e164, token: code, type: 'sms' });
    if (error || !data.user) {
      setBusy(false);
      return setErr(error?.message ?? t('invalidCode'));
    }
    const c = claimsFromUser(data.user);
    if ((portal === 'platform') !== c.platform) {
      await sb.auth.signOut();
      setBusy(false);
      return setErr(portal === 'platform' ? t('notStaff') : t('staffHere'));
    }
    await applyProfileLocale();
    router.replace(landingFor(c));
    router.refresh();
  }

  return (
    <form className="card" onSubmit={sent ? verify : send} style={{ display: 'grid', gap: 10 }}>
      <div className="field">
        <label htmlFor="phone">{t('mobile')}</label>
        <input id="phone" type="tel" inputMode="numeric" autoComplete="tel" placeholder="98490 12345"
          value={phone} onChange={(e) => setPhone(e.target.value)} disabled={sent} required />
      </div>
      {sent && (
        <div className="field">
          <label htmlFor="otp">{t('code')}</label>
          <input id="otp" inputMode="numeric" autoComplete="one-time-code" maxLength={6}
            value={code} onChange={(e) => setCode(e.target.value)} required />
        </div>
      )}
      {err && <div className="pill crit" role="alert" style={{ whiteSpace: 'normal' }}>{err}</div>}
      <button className="btn" disabled={busy}>{sent ? t('verify') : t('sendOtp')}</button>
      {sent && (
        <button type="button" className="btn secondary" onClick={() => { setSent(false); setCode(''); }}>
          {t('changeNumber')}
        </button>
      )}
    </form>
  );
}
