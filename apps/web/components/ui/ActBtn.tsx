'use client';
import { createContext, useContext } from 'react';
import { openAct, type ActCtx } from '@/components/forms/ActionHost';
import { ACT_ROLES, canAct } from '@/lib/auth/permissions';

/** Signed-in user's roles, provided by the app shell. null = don't filter (e.g. platform console). */
export const RolesContext = createContext<string[] | null>(null);
// buttons that open another act's form / save through another act
const SAME_AS: Record<string, string> = { addShedPick: 'addShed', addVisitPick: 'addVisit', payQuick: 'payOpen', attCycle: 'attSet', attSubmit: 'attSet', approvePay: 'decidePay', rejectPay: 'decidePay' };

/**
 * Every demo action button (data-act="…"). Renders exactly like the demo; ActionHost (in the shell)
 * opens the matching form with `ctx` (ids of the row the button sits on). Hidden when the user's role
 * can't run it — the server refuses anyway (runAct), this just keeps screens honest.
 */
export function ActBtn({ act, ctx, className, children, style }: {
  act: string; ctx?: ActCtx; className?: string; children: React.ReactNode; style?: React.CSSProperties;
}) {
  const roles = useContext(RolesContext);
  const key = SAME_AS[act] ?? act;
  if (roles && ACT_ROLES[key] && !canAct(roles, key)) return null;
  return (
    <button type="button" className={className} style={style} data-act={act}
      onClick={(e) => { e.preventDefault(); e.stopPropagation(); openAct(act, ctx); }}>
      {children}
    </button>
  );
}
