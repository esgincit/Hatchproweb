'use client';
// Money › Receivables "WhatsApp reminders": one row per overdue customer. Send opens WhatsApp (wa.me) with the
// message ready in the chosen language and logs the reminder (reminder_log, migration 0020). Opened by the
// existing `remind` ActBtn (role-gated there); ActionHost leaves that act to this sheet.
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { runAct } from '@/app/actions/forms';
import { Sheet } from '@/components/ui/Sheet';
import { toast } from '@/components/ui/Toast';
import { fmtL } from '@/lib/format';
import { LOCALES, LOCALE_NAMES, type Locale } from '@/lib/i18n/locales';
import { waLink, type Due } from '@/lib/remind';

/** `last` = days since the latest reminder (null = never); `msgs` = the message in every language. */
export type RemindRow = Due & { last: number | null; msgs: Record<Locale, string> };

export function RemindSheet({ rows, lang: initial }: { rows: RemindRow[]; lang: Locale }) {
  const t = useTranslations('remind');
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [lang, setLang] = useState<Locale>(initial);
  useEffect(() => {
    const on = (e: Event) => { if ((e as CustomEvent<{ act: string }>).detail.act === 'remind') setOpen(true); };
    window.addEventListener('hp-act', on);
    return () => window.removeEventListener('hp-act', on);
  }, []);
  // the link opens WhatsApp in a new tab/app; logging runs alongside and never blocks it
  const log = async (r: RemindRow) => {
    const res = await runAct('remind', { customer_id: r.customer_id, invoice_ids: r.invoices.map((i) => i.id), amount: r.amount, lang });
    toast(res.ok ? res.msg : res.error);
    if (res.ok) router.refresh();
  };

  return (
    <Sheet open={open} onOpenChange={setOpen} title={t('title')}>
      <p className="s" style={{ margin: '4px 0 10px' }}>{t('hint')}</p>
      <div className="field" style={{ marginBottom: 10 }}>
        <label htmlFor="remind-lang">{t('lang')}</label>
        <select id="remind-lang" value={lang} onChange={(e) => setLang(e.target.value as Locale)}>
          {LOCALES.map((l) => <option key={l} value={l}>{LOCALE_NAMES[l]}</option>)}
        </select>
      </div>
      <div className="list">
        {rows.map((r) => (
          <div className="item" key={r.customer_id} data-testid="remind-row">
            <div>
              <div className="t">{r.name}</div>
              <div className="s">{t('due', { amount: fmtL(r.amount), count: r.invoices.length, days: r.days })}</div>
              <div className="s">{r.last == null ? t('never') : r.last === 0 ? t('today') : t('ago', { n: r.last })}</div>
            </div>
            <div className="r">
              {r.phone ? (
                <a className="btn small" href={waLink(r.phone, r.msgs[lang])} target="_blank" rel="noopener noreferrer" onClick={() => void log(r)}
                  style={{ textDecoration: 'none', whiteSpace: 'nowrap' }}>
                  {t('send')}
                </a>
              ) : (
                <span className="s">{t('noPhone')}</span>
              )}
            </div>
          </div>
        ))}
        {!rows.length && <div className="s">{t('none')}</div>}
      </div>
    </Sheet>
  );
}
