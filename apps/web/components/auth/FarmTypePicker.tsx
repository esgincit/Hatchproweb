'use client';
import { useTransition } from 'react';
import { setFarmType } from '@/app/actions/farm-type';
import { FARM_TYPE_INFO, type FarmType } from '@/lib/farm-types';

export function FarmTypePicker({ options, current }: { options: FarmType[]; current?: FarmType | null }) {
  const [pending, start] = useTransition();
  return (
    <div className="menu">
      {options.map((ft) => (
        <button key={ft} type="button" disabled={pending} onClick={() => start(() => setFarmType(ft))}
          style={ft === current ? { borderColor: 'var(--accent)', background: 'var(--accent-soft)' } : undefined}>
          <span className="t">
            {FARM_TYPE_INFO[ft].label}{' '}
            <small style={{ fontFamily: 'var(--te)', color: 'var(--muted)' }}>{FARM_TYPE_INFO[ft].te}</small>
          </span>
          <span className="s">{FARM_TYPE_INFO[ft].blurb}</span>
        </button>
      ))}
    </div>
  );
}
