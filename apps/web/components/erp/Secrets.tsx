'use client';
// Create an API key / webhook. The plain secret comes back once and lives only in this component's state until "Done" — nothing is stored.
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { createApiKey, createWebhook, type SecretResult } from '@/app/actions/secrets';
import { API_SCOPES, WEBHOOK_EVENTS } from '@/lib/schemas';

type Kind = 'key' | 'hook';

export function SecretCreate({ kind }: { kind: Kind }) {
  const t = useTranslations('setg');
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [secret, setSecret] = useState<string | null>(null);
  const opts: readonly string[] = kind === 'key' ? API_SCOPES : WEBHOOK_EVENTS;

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const picked = f.getAll('pick').map(String);
    setBusy(true); setErr(null);
    const r: SecretResult = kind === 'key'
      ? await createApiKey({ name: f.get('name'), scopes: picked })
      : await createWebhook({ url: f.get('url'), events: picked });
    setBusy(false);
    if (!r.ok) return setErr(r.error);
    setSecret(r.secret);
    router.refresh();
  }
  const done = () => { setSecret(null); setOpen(false); setErr(null); };

  if (secret) {
    return (
      <div className="card stripe warn" data-testid="secret-once" role="status">
        <div className="t">{t(kind === 'key' ? 'keyOnce' : 'hookOnce')}</div>
        <code data-testid="secret-value" style={{ display: 'block', wordBreak: 'break-all', margin: '8px 0' }}>{secret}</code>
        <div className="row" style={{ gap: 6 }}>
          <button type="button" className="btn small secondary" onClick={() => navigator.clipboard?.writeText(secret)}>{t('copy')}</button>
          <button type="button" className="btn small" onClick={done}>{t('done')}</button>
        </div>
      </div>
    );
  }
  if (!open) return <button type="button" className="btn small" onClick={() => setOpen(true)} data-testid={`new-${kind}`}>{t(kind === 'key' ? 'newKey' : 'newHook')}</button>;
  return (
    <form onSubmit={submit} data-testid={`form-${kind}`} style={{ display: 'grid', gap: 8, width: '100%' }}>
      <div className="field">
        <label htmlFor={`sc_${kind}`}>{t(kind === 'key' ? 'f.keyName' : 'f.url')}</label>
        {kind === 'key' ? <input id="sc_key" name="name" required maxLength={60} /> : <input id="sc_hook" name="url" required type="url" placeholder="https://" maxLength={300} />}
      </div>
      <fieldset style={{ border: 0, padding: 0, display: 'grid', gap: 4 }}>
        <legend className="s">{t(kind === 'key' ? 'f.scopes' : 'f.events')}</legend>
        {opts.map((o) => <label key={o} className="row" style={{ gap: 6 }}><input type="checkbox" name="pick" value={o} defaultChecked={o === opts[0]} /> {o}</label>)}
      </fieldset>
      {err && <div className="pill crit" role="alert" style={{ whiteSpace: 'normal' }}>{err}</div>}
      <div className="row" style={{ gap: 6 }}>
        <button className="btn small" disabled={busy}>{t('create')}</button>
        <button type="button" className="btn small secondary" onClick={done}>{t('cancel')}</button>
      </div>
    </form>
  );
}
