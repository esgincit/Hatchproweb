'use client';
// Public application form (R3/R6/R9 capture): business & KYC, contact, farm site with live GPS, sheds,
// operations, labour. Submitted for platform review — no account is created here.
import { useCallback, useRef, useState } from 'react';
import Link from 'next/link';
import { PhoneVerify } from './PhoneVerify';
import { useLocale, useTranslations } from 'next-intl';
import { submitApplication } from '@/app/actions/apply';
import { APPLY } from '@/lib/schemas';

type Shed = { name: string; length_ft: string; width_ft: string; type: string; floor: string; capacity: string };
const blankShed = (n: number): Shed => ({ name: `Shed ${n}`, length_ft: '', width_ft: '', type: 'open', floor: 'deep_litter', capacity: '' });

export function ApplyForm() {
  const t = useTranslations('apply');
  const tf = useTranslations('farmType');
  const locale = useLocale();
  const [sheds, setSheds] = useState<Shed[]>([blankShed(1)]);
  const [types, setTypes] = useState<string[]>(['broiler']);
  const [gps, setGps] = useState<{ lat: string; lng: string }>({ lat: '', lng: '' });
  const [gpsMsg, setGpsMsg] = useState('');
  const [bad, setBad] = useState<string[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [ver, setVer] = useState<{ checkId: string | null; documents: { path: string; name: string }[] }>({ checkId: null, documents: [] });
  const form = useRef<HTMLFormElement>(null);
  const onVer = useCallback((v: typeof ver) => setVer(v), []);

  const locate = () => {
    if (!navigator.geolocation) return setGpsMsg(t('gpsUnsupported'));
    setGpsMsg(t('gpsFinding'));
    navigator.geolocation.getCurrentPosition(
      (p) => { setGps({ lat: p.coords.latitude.toFixed(6), lng: p.coords.longitude.toFixed(6) }); setGpsMsg(t('gpsOk', { acc: Math.round(p.coords.accuracy) })); },
      () => setGpsMsg(t('gpsDenied')),
      { enableHighAccuracy: true, timeout: 15000 },
    );
  };

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = Object.fromEntries([...new FormData(e.currentTarget).entries()].map(([k, v]) => [k, String(v)]));
    const input = { ...fd, farm_types: types, sheds, lat: gps.lat, lng: gps.lng, consent: fd.consent === 'on', phone_check_id: ver.checkId ?? '', documents: ver.documents };
    const local = APPLY.safeParse(input);
    if (!local.success) {
      const fields = local.error.issues.map((i) => String(i.path[0]));
      setBad(fields); setErr(fields.includes('phone_check_id') ? t('verifyFirst') : t('invalid')); return;
    }
    setBusy(true);
    const r = await submitApplication(input);
    setBusy(false);
    if (!r.ok) { setBad(r.fields ?? []); setErr(r.error); return; }
    setDone(true);
  }

  if (done)
    return (
      <div className="card" style={{ background: 'var(--good-soft)', borderColor: 'transparent' }}>
        <div className="t" style={{ fontWeight: 700 }}>{t('thanks')}</div>
        <div className="s" style={{ marginTop: 6 }}>{t('thanksBody')}</div>
        <Link className="btn secondary" href="/login" style={{ display: 'block', textAlign: 'center', marginTop: 12, textDecoration: 'none' }}>{t('toLogin')}</Link>
      </div>
    );

  const inv = (id: string) => (bad.includes(id) ? { borderColor: 'var(--crit)' } : undefined);
  const field = (id: string, label: string, o: { type?: string; half?: boolean; required?: boolean; placeholder?: string; value?: string; inputMode?: 'numeric' | 'decimal' | 'tel' | 'email' } = {}) => (
    <div className="field" style={o.half ? undefined : { gridColumn: '1/-1' }}>
      <label htmlFor={'a_' + id}>{label}{o.required ? ' *' : ''}</label>
      <input id={'a_' + id} name={id} type={o.type ?? 'text'} inputMode={o.inputMode} placeholder={o.placeholder} defaultValue={o.value} style={inv(id)} aria-invalid={bad.includes(id) || undefined} />
    </div>
  );
  const select = (id: string, label: string, opts: [string, string][], o: { half?: boolean; value?: string } = {}) => (
    <div className="field" style={o.half ? undefined : { gridColumn: '1/-1' }}>
      <label htmlFor={'a_' + id}>{label} *</label>
      <select id={'a_' + id} name={id} defaultValue={o.value ?? opts[0][0]} style={inv(id)}>{opts.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
    </div>
  );
  const grid = { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 } as const;
  const setShed = (i: number, k: keyof Shed, v: string) => setSheds(sheds.map((s, j) => (j === i ? { ...s, [k]: v } : s)));
  const totalCap = sheds.reduce((a, s) => a + (Number(s.capacity) || 0), 0);

  return (
    <form ref={form} onSubmit={submit} noValidate style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div className="card"><div className="eyebrow" style={{ marginBottom: 8 }}>{t('business')}</div>
        <div style={grid}>
          {field('business_name', t('businessName'), { required: true })}
          {field('legal_name', t('legalName'))}
          {select('entity_type', t('entityType'), (['proprietor', 'partnership', 'llp', 'pvt_ltd', 'fpo', 'cooperative'] as const).map((k) => [k, t(`entity.${k}`)]), { half: true })}
          {field('pan', t('pan'), { half: true, required: true, placeholder: 'ABCDE1234F' })}
          {field('gstin', t('gstin'), { half: true, placeholder: '36ABCDE1234F1Z5' })}
          {field('udyam', t('udyam'), { half: true })}
          {field('fssai', t('fssai'), { half: true })}
          {field('pcb_ref', t('pcb'), { half: true })}
          {field('trade_licence', t('tradeLicence'))}
        </div>
      </div>

      <div className="card"><div className="eyebrow" style={{ marginBottom: 8 }}>{t('contact')}</div>
        <div style={grid}>
          {field('owner_name', t('ownerName'), { required: true })}
          {field('phone', t('phone'), { half: true, required: true, type: 'tel', inputMode: 'tel', placeholder: '98490 12345' })}
          {field('alt_phone', t('altPhone'), { half: true, type: 'tel', inputMode: 'tel' })}
          {field('email', t('email'), { half: true, type: 'email', inputMode: 'email' })}
          {field('whatsapp', t('whatsapp'), { half: true, type: 'tel', inputMode: 'tel' })}
          {select('language', t('language'), [['te', 'తెలుగు'], ['hi', 'हिन्दी'], ['ta', 'தமிழ்'], ['kn', 'ಕನ್ನಡ'], ['en', 'English']], { value: locale })}
        </div>
      </div>
      <PhoneVerify phoneOf={() => String((form.current?.elements.namedItem('phone') as HTMLInputElement | null)?.value ?? '')} onChange={onVer} />

      <div className="card"><div className="eyebrow" style={{ marginBottom: 8 }}>{t('farm')}</div>
        <div className="s" style={{ marginBottom: 6 }}>{t('farmTypes')} *</div>
        <div className="chips" style={{ flexWrap: 'wrap', marginBottom: 10 }}>
          {(['broiler', 'layer', 'hatchery', 'breeder'] as const).map((k) => (
            <button key={k} type="button" className={`chip ${types.includes(k) ? 'active' : ''}`} aria-pressed={types.includes(k)}
              onClick={() => setTypes(types.includes(k) ? types.filter((x) => x !== k) : [...types, k])}>{tf(k)}</button>
          ))}
        </div>
        <div style={grid}>
          {field('site_name', t('siteName'), { required: true })}
          {field('village', t('village'), { half: true })}
          {field('mandal', t('mandal'), { half: true })}
          {field('district', t('district'), { half: true, required: true })}
          {field('state', t('state'), { half: true, required: true, value: 'Telangana' })}
          {field('pin', t('pin'), { half: true, required: true, inputMode: 'numeric', placeholder: '505468' })}
          {field('land_acres', t('acres'), { half: true, type: 'number', inputMode: 'decimal' })}
          {select('ownership', t('ownership'), [['owned', t('owned')], ['leased', t('leased')]], { half: true })}
          <div className="field" style={{ gridColumn: '1/-1' }}>
            <label>{t('gps')}</label>
            <div className="row" style={{ gap: 8 }}>
              <button type="button" className="btn small secondary" onClick={locate}>📍 {t('useLocation')}</button>
              <span className="s" style={{ color: bad.includes('lat') ? 'var(--crit)' : 'var(--ink2)' }}>
                {gps.lat ? <a href={`https://maps.google.com/?q=${gps.lat},${gps.lng}`} target="_blank" rel="noreferrer">{gps.lat}, {gps.lng}</a> : gpsMsg || t('gpsHint')}
              </span>
            </div>
          </div>
        </div>
      </div>

      <div className="card">
        <div className="row between" style={{ marginBottom: 8 }}>
          <div className="eyebrow">{t('sheds')} · {sheds.length} · {t('totalCap', { n: totalCap.toLocaleString('en-IN') })}</div>
          <button type="button" className="btn small" onClick={() => setSheds([...sheds, blankShed(sheds.length + 1)])}>+ {t('addShed')}</button>
        </div>
        {sheds.map((s, i) => (
          <div key={i} style={{ ...grid, paddingTop: i ? 10 : 0, borderTop: i ? '1px solid var(--line)' : undefined, marginTop: i ? 10 : 0 }}>
            <div className="field" style={{ gridColumn: '1/-1' }}>
              <div className="row between"><label htmlFor={`s_${i}_name`}>{t('shedName')}</label>
                {sheds.length > 1 && <button type="button" className="back" onClick={() => setSheds(sheds.filter((_, j) => j !== i))}>✕ {t('remove')}</button>}</div>
              <input id={`s_${i}_name`} value={s.name} onChange={(e) => setShed(i, 'name', e.target.value)} />
            </div>
            <div className="field"><label htmlFor={`s_${i}_l`}>{t('length')}</label><input id={`s_${i}_l`} type="number" inputMode="decimal" value={s.length_ft} onChange={(e) => setShed(i, 'length_ft', e.target.value)} /></div>
            <div className="field"><label htmlFor={`s_${i}_w`}>{t('width')}</label><input id={`s_${i}_w`} type="number" inputMode="decimal" value={s.width_ft} onChange={(e) => setShed(i, 'width_ft', e.target.value)} /></div>
            <div className="field"><label htmlFor={`s_${i}_t`}>{t('housing')}</label>
              <select id={`s_${i}_t`} value={s.type} onChange={(e) => setShed(i, 'type', e.target.value)}>
                {(['open', 'semi_ec', 'environment_controlled'] as const).map((k) => <option key={k} value={k}>{t(`housingType.${k}`)}</option>)}
              </select></div>
            <div className="field"><label htmlFor={`s_${i}_f`}>{t('floor')}</label>
              <select id={`s_${i}_f`} value={s.floor} onChange={(e) => setShed(i, 'floor', e.target.value)}>
                {(['deep_litter', 'cage', 'slatted'] as const).map((k) => <option key={k} value={k}>{t(`floorType.${k}`)}</option>)}
              </select></div>
            <div className="field" style={{ gridColumn: '1/-1' }}><label htmlFor={`s_${i}_c`}>{t('maxBirds')} *</label>
              <input id={`s_${i}_c`} type="number" inputMode="numeric" value={s.capacity} onChange={(e) => setShed(i, 'capacity', e.target.value)}
                style={bad.includes('sheds') && !(Number(s.capacity) > 0) ? { borderColor: 'var(--crit)' } : undefined} /></div>
          </div>
        ))}
      </div>

      <div className="card"><div className="eyebrow" style={{ marginBottom: 8 }}>{t('operations')}</div>
        <div style={grid}>
          {field('current_birds', t('currentBirds'), { half: true, type: 'number', inputMode: 'numeric' })}
          {field('breed', t('breed'), { half: true, placeholder: 'Cobb 430, BV-300…' })}
          {select('model', t('model'), [['independent', t('modelIndependent')], ['integrator', t('modelIntegrator')], ['own_integration', t('modelOwn')]], { half: true })}
          {field('integrator', t('integrator'), { half: true })}
          {field('monthly_volume', t('monthlyVolume'), { type: 'number', inputMode: 'numeric' })}
        </div>
      </div>

      <div className="card"><div className="eyebrow" style={{ marginBottom: 8 }}>{t('labour')}</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 10 }}>
          {(['supervisor', 'worker', 'vaccinator', 'driver', 'technician'] as const).map((k) => (
            <div className="field" key={k}><label htmlFor={'a_labour_' + k}>{t(`labourRole.${k}`)}</label>
              <input id={'a_labour_' + k} name={'labour_' + k} type="number" inputMode="numeric" min={0} /></div>
          ))}
        </div>
      </div>

      <label className="card row" style={{ gap: 10, alignItems: 'flex-start', ...(bad.includes('consent') ? { borderColor: 'var(--crit)' } : {}) }}>
        <input type="checkbox" name="consent" style={{ width: 20, height: 20, marginTop: 2 }} />
        <span className="s">{t('consent')}</span>
      </label>
      {err && <div className="pill crit" role="alert" style={{ whiteSpace: 'normal' }}>{err}</div>}
      <button className="btn" type="submit" disabled={busy}>{t('submit')}</button>
    </form>
  );
}
