'use client';
import { useTranslations } from 'next-intl';
import { Sheet } from '@/components/ui/Sheet';
import { FarmTypePicker } from '@/components/auth/FarmTypePicker';
import { LanguagePicker } from '@/components/i18n/LanguagePicker';
import { SignOutButton } from './SignOutButton';
import type { FarmType } from '@/lib/farm-types';

export function TenantSheet({ open, onOpenChange, modes, mode }: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  modes: FarmType[];
  mode: FarmType;
}) {
  const t = useTranslations('shell');
  return (
    <Sheet open={open} onOpenChange={onOpenChange} title={t('switchView')}>
      {modes.length > 1 && <FarmTypePicker options={modes} current={mode} />}
      <LanguagePicker />
      <SignOutButton />
    </Sheet>
  );
}
