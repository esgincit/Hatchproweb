'use client';
import { useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { setFarmType } from '@/app/actions/farm-type';
import type { FarmType } from '@/lib/farm-types';

export function FarmTypePicker({ options, current }: { options: FarmType[]; current?: FarmType | null }) {
  const t = useTranslations('farmType');
  const [pending, start] = useTransition();
  return (
    <div className="menu">
      {options.map((ft) => (
        <button key={ft} type="button" disabled={pending} onClick={() => start(() => setFarmType(ft))}
          style={ft === current ? { borderColor: 'var(--accent)', background: 'var(--accent-soft)' } : undefined}>
          <span className="t">{t(ft)}</span>
          <span className="s">{t(`${ft}Blurb`)}</span>
        </button>
      ))}
    </div>
  );
}
