'use client';
// Apply form, step "prove your mobile + attach documents" (0030, supabase/functions/apply-otp):
// Turnstile captcha → SMS code → verified check id; then up to 5 licence/ID files go straight to the private
// documents bucket through one-time signed upload URLs. The application insert is refused without a verified check.
import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { createClient } from '@/lib/supabase/client';

const SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;
type Doc = { path: string; name: string };
type TS = { render: (el: HTMLElement, o: Record<string, unknown>) => string; reset: (id?: string) => void };

export function PhoneVerify({ phoneOf, onChange }: { phoneOf: () => string; onChange: (v: { checkId: string | null; documents: Doc[] }) => void }) {
  const t = useTranslations('apply');
  const sb = useRef(createClient()).current;
  const [checkId, setCheckId] = useState<string | null>(null);
  const [verified, setVerified] = useState(false);
  const [code, setCode] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [docs, setDocs] = useState<Doc[]>([]);
  const captcha = useRef<string | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const widget = useRef<string | null>(null);

  useEffect(() => { // Cloudflare Turnstile (skipped when no site key is configured — dev)
    if (!SITE_KEY || !box.current) return;
    const render = () => { const ts = (window as unknown as { turnstile?: TS }).turnstile; if (ts && box.current && !widget.current) widget.current = ts.render(box.current, { sitekey: SITE_KEY, callback: (tok: string) => { captcha.current = tok; } }); };
    if ((window as unknown as { turnstile?: TS }).turnstile) return render();
    const s = document.createElement('script');
    s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
    s.async = true; s.onload = render;
    document.head.appendChild(s);
  }, []);
  useEffect(() => { onChange({ checkId: verified ? checkId : null, documents: docs }); }, [verified, checkId, docs, onChange]);

  const call = async (body: Record<string, unknown>) => {
    const r = await sb.functions.invoke('apply-otp', { body });
    if (!r.error) return r.data as Record<string, string>;
    const err = await (r.error as { context?: Response }).context?.json().catch(() => null);
    throw new Error(err?.error ?? 'server');
  };
  const say = (e: unknown) => setMsg(t.has(`otp.${(e as Error).message}`) ? t(`otp.${(e as Error).message}`) : t('otp.server'));

  async function send() {
    const digits = phoneOf().replace(/\D/g, '').slice(-10);
    if (!/^[6-9]\d{9}$/.test(digits)) return setMsg(t('otp.bad_phone'));
    setBusy(true); setMsg(null);
    try {
      const d = await call({ action: 'send', phone: '+91' + digits, captcha: captcha.current });
      setCheckId(d.check_id); setVerified(false); setCode(''); setMsg(t('otp.sent'));
    } catch (e) { say(e); }
    finally {
      setBusy(false);
      captcha.current = null; // tokens are single-use
      if (widget.current) (window as unknown as { turnstile?: TS }).turnstile?.reset(widget.current);
    }
  }
  async function verify() {
    setBusy(true); setMsg(null);
    try { await call({ action: 'verify', check_id: checkId, code }); setVerified(true); }
    catch (e) { say(e); }
    finally { setBusy(false); }
  }
  async function attach(files: FileList | null) {
    if (!files || !checkId) return;
    setBusy(true); setMsg(null);
    try {
      for (const f of [...files].slice(0, 5 - docs.length)) {
        const d = await call({ action: 'upload-url', check_id: checkId, name: f.name, type: f.type, size: f.size });
        const up = await sb.storage.from('documents').uploadToSignedUrl(d.path, d.token, f, { contentType: f.type });
        if (up.error) throw new Error('server');
        setDocs((x) => [...x, { path: d.path, name: f.name.slice(0, 120) }]);
      }
    } catch (e) { say(e); }
    finally { setBusy(false); }
  }

  return (
    <div className="card" data-testid="phone-verify" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div className="eyebrow">{t('otp.title')}</div>
      {verified ? <div className="pill good">{t('otp.verified')}</div> : <>
        <div ref={box} />
        <button type="button" className="btn secondary" disabled={busy} onClick={send}>{checkId ? t('otp.resend') : t('otp.send')}</button>
        {checkId && (
          <div className="row" style={{ gap: 8 }}>
            <input aria-label={t('otp.code')} inputMode="numeric" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
              style={{ flex: 1, fontSize: 20, letterSpacing: 4, textAlign: 'center' }} />
            <button type="button" className="btn" disabled={busy || code.length !== 6} onClick={verify}>{t('otp.verify')}</button>
          </div>
        )}
      </>}
      {verified && <>
        <div className="eyebrow" style={{ marginTop: 6 }}>{t('docs.title')}</div>
        <div className="s">{t('docs.hint')}</div>
        {docs.map((d) => <div key={d.path} className="s">📎 {d.name}</div>)}
        {docs.length < 5 && (
          <label className="btn secondary" style={{ textAlign: 'center' }}>{t('docs.add')}
            <input type="file" multiple accept="image/jpeg,image/png,application/pdf" hidden disabled={busy} onChange={(e) => { attach(e.target.files); e.target.value = ''; }} />
          </label>
        )}
      </>}
      {msg && <div className="s" role="status">{msg}</div>}
    </div>
  );
}
