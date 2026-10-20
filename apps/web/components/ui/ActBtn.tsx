'use client';
import { openAct, type ActCtx } from '@/components/forms/ActionHost';

/**
 * Every demo action button (data-act="…"). Renders exactly like the demo; ActionHost (in the shell)
 * opens the matching form with `ctx` (ids of the row the button sits on).
 */
export function ActBtn({ act, ctx, className, children, style }: {
  act: string; ctx?: ActCtx; className?: string; children: React.ReactNode; style?: React.CSSProperties;
}) {
  return (
    <button type="button" className={className} style={style} data-act={act}
      onClick={(e) => { e.preventDefault(); e.stopPropagation(); openAct(act, ctx); }}>
      {children}
    </button>
  );
}
