'use client';
// The demo's generic bottom-sheet form (demo/index.html form(), :180-201) as a component:
// two-column grid, `half` fields share a row, full-width accent submit, cancel below.
import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Sheet } from '@/components/ui/Sheet';

export type Field = {
  id: string;
  label: string;
  type?: 'text' | 'number' | 'date' | 'select' | 'textarea' | 'tel';
  options?: [value: string, label: string][];
  value?: string | number;
  half?: boolean;
  required?: boolean;
  step?: string;
  placeholder?: string;
  hint?: string;
  max?: string;
};

export type FormSpec = {
  title: string;
  intro?: string;
  fields: Field[];
  submit: string;
  danger?: boolean;
  /** hidden values (ids from the row that opened the form) */
  hidden?: Record<string, string>;
  /** reshape values before validation, e.g. a combined picker → kind + id */
  transform?: (v: Record<string, string>) => Record<string, unknown>;
};

export function FormSheet({ spec, open, onOpenChange, onSubmit }: {
  spec: FormSpec | null;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  /** returns field ids that failed (to highlight) or an error message */
  onSubmit: (values: Record<string, unknown>) => Promise<{ fields?: string[]; error?: string } | void>;
}) {
  const t = useTranslations('common');
  const [busy, setBusy] = useState(false);
  const [bad, setBad] = useState<string[]>([]);
  const [err, setErr] = useState<string | null>(null);
  if (!spec) return null;

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const raw = Object.fromEntries([...new FormData(e.currentTarget).entries()].map(([k, v]) => [k, String(v)]));
    const values = { ...(spec!.transform ? spec!.transform(raw) : raw), ...spec!.hidden };
    setBusy(true);
    setErr(null);
    const r = await onSubmit(values);
    setBusy(false);
    setBad(r?.fields ?? []);
    setErr(r?.error ?? null);
  }

  return (
    <Sheet open={open} onOpenChange={(o) => { if (!o) { setBad([]); setErr(null); } onOpenChange(o); }} title={spec.title}>
      {spec.intro && <div className="s" style={{ color: 'var(--ink2)', fontSize: 12.5 }}>{spec.intro}</div>}
      <form onSubmit={submit} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }} noValidate>
        {spec.fields.map((f) => {
          const common = {
            id: 'f_' + f.id, name: f.id, required: f.required, 'aria-invalid': bad.includes(f.id) || undefined,
            style: bad.includes(f.id) ? { borderColor: 'var(--crit)' } : undefined,
          };
          return (
            <div key={f.id} className="field" style={f.half ? undefined : { gridColumn: '1/-1' }}>
              <label htmlFor={'f_' + f.id}>
                {f.label}
                {f.hint && <span style={{ color: 'var(--muted)', fontWeight: 500 }}> {f.hint}</span>}
              </label>
              {f.type === 'select' ? (
                <select {...common} defaultValue={f.value === undefined ? '' : String(f.value)}>
                  {f.options?.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
              ) : f.type === 'textarea' ? (
                <textarea {...common} rows={2} placeholder={f.placeholder} defaultValue={f.value ?? ''} />
              ) : (
                <input {...common} type={f.type ?? 'text'} inputMode={f.type === 'number' ? 'decimal' : f.type === 'tel' ? 'tel' : undefined}
                  step={f.step ?? (f.type === 'number' ? 'any' : undefined)} max={f.max} placeholder={f.placeholder} defaultValue={f.value ?? ''} />
              )}
            </div>
          );
        })}
        {err && <div className="pill crit" role="alert" style={{ gridColumn: '1/-1', whiteSpace: 'normal' }}>{err}</div>}
        <button className={`btn ${spec.danger ? 'danger' : ''}`} type="submit" disabled={busy} style={{ gridColumn: '1/-1' }}>{spec.submit}</button>
        <button className="btn secondary" type="button" onClick={() => onOpenChange(false)} style={{ gridColumn: '1/-1' }}>{t('cancel')}</button>
      </form>
    </Sheet>
  );
}
