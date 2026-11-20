// Alert lifecycle (0061 alert_step): open -> acknowledged -> actioned -> resolved, plus "Escalated" when nobody acknowledged in time.
// Shown under each notification of kind 'alert' on More > Notifications. Any active member may work an alert.
import { createClient } from '@/lib/supabase/server';
import { ActBtn } from '@/components/ui/ActBtn';
import type { Row, T } from './bits';

const PILL: Record<string, string> = { open: 'crit', ack: 'warn', actioned: 'warn', resolved: 'good' };
const stamp = (iso: string) => new Date(iso).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });

export const alertState = (a: Row) => (a.resolved_at ? 'resolved' : a.actioned_at ? 'actioned' : a.acknowledged_at ? 'ack' : 'open');

/** lifecycle columns + the names of whoever acted, for the given notification ids */
export async function loadAlerts(ids: number[]) {
  if (!ids.length) return { life: new Map<number, Row>(), names: new Map<string, string>() };
  const sb = await createClient();
  const { data } = await sb.from('notification')
    .select('id,acknowledged_at,acknowledged_by,actioned_at,actioned_by,action_note,resolved_at,resolved_by,escalated_at').in('id', ids);
  const life = new Map<number, Row>((data ?? []).map((r: Row) => [Number(r.id), r]));
  const who = [...new Set((data ?? []).flatMap((r: Row) => [r.acknowledged_by, r.actioned_by, r.resolved_by]).filter(Boolean))] as string[];
  const { data: us } = who.length ? await sb.from('app_user').select('id,full_name').in('id', who) : { data: [] as Row[] };
  return { life, names: new Map<string, string>((us ?? []).map((u: Row) => [u.id, u.full_name])) };
}

export function AlertSteps({ id, title, a, names, t }: { id: number; title: string; a: Row | undefined; names: Map<string, string>; t: T }) {
  if (!a) return null;
  const state = alertState(a);
  const by = (u?: string | null) => (u && names.get(u) ? ` · ${names.get(u)}` : '');
  const ctx = { id: String(id), title, needNote: a.actioned_at ? '0' : '1' };
  return (
    <div data-testid="alert-life" data-state={state} style={{ marginTop: 4 }}>
      <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
        <span className={`pill ${PILL[state]}`} data-testid="alert-state">{t(`gap.alert.state.${state}`)}</span>
        {a.escalated_at && <span className="pill crit" data-testid="alert-escalated">{t('gap.alert.escalated')}</span>}
        {state === 'open' && <ActBtn act="ackAlert" ctx={ctx} className="btn small secondary">{t('gap.alert.ack')}</ActBtn>}
        {state !== 'resolved' && <ActBtn act="actAlert" ctx={ctx} className="btn small secondary">{t('gap.alert.action')}</ActBtn>}
        {state !== 'resolved' && <ActBtn act="resolveAlert" ctx={ctx} className="btn small">{t('gap.alert.resolve')}</ActBtn>}
      </div>
      {a.acknowledged_at && <div className="s" data-testid="alert-ack">{t('gap.alert.ackedLine', { when: stamp(a.acknowledged_at) })}{by(a.acknowledged_by)}</div>}
      {a.action_note && <div className="s" data-testid="alert-note">{t('gap.alert.noteLine', { note: a.action_note })}{by(a.actioned_by)}</div>}
      {a.resolved_at && <div className="s" data-testid="alert-resolved">{t('gap.alert.resolvedLine', { when: stamp(a.resolved_at) })}{by(a.resolved_by)}</div>}
    </div>
  );
}
