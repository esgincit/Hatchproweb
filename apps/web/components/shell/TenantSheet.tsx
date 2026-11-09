'use client';
import { useTranslations } from 'next-intl';
import { Sheet } from '@/components/ui/Sheet';
import { FarmTypePicker } from '@/components/auth/FarmTypePicker';
import { LanguagePicker } from '@/components/i18n/LanguagePicker';
import { SignOutButton } from './SignOutButton';
import type { FarmType } from '@/lib/farm-types';

export function TenantSheet({ open, onOpenChange, modes, mode, name, initials, sub }: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  modes: FarmType[];
  mode: FarmType;
  name: string;
  initials: string;
  sub: string;
}) {
  const t = useTranslations('shell');
  return (
    <Sheet open={open} onOpenChange={onOpenChange} title={t('switchView')}>
      <div className="profile">
        <span className="avatar">{initials}</span>
        <span style={{ minWidth: 0 }}>
          <div className="name">{name}</div>
          <div className="sub">{sub}</div>
        </span>
      </div>
      {modes.length > 1 && <FarmTypePicker options={modes} current={mode} />}
      <LanguagePicker />
      <SignOutButton />
    </Sheet>
  );
}
