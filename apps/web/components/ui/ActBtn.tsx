'use client';
import { toast } from './Toast';

/**
 * Every demo action button (data-act="…"). Renders exactly like the demo; the forms behind
 * each `act` key arrive with SchemaForm in the next step, until then a toast says so.
 */
export function ActBtn({ act, className, children, style }: { act: string; className?: string; children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <button type="button" className={className} style={style} data-act={act}
      onClick={(e) => { e.preventDefault(); e.stopPropagation(); toast('This form is coming in the next update'); }}>
      {children}
    </button>
  );
}
