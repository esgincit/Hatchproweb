'use client';
import { Sheet } from '@/components/ui/Sheet';
import { FarmTypePicker } from '@/components/auth/FarmTypePicker';
import { SignOutButton } from './SignOutButton';
import type { FarmType } from '@/lib/farm-types';

export function TenantSheet({ open, onOpenChange, modes, mode }: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  modes: FarmType[];
  mode: FarmType;
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange} title="Switch view">
      {modes.length > 1 && <FarmTypePicker options={modes} current={mode} />}
      <SignOutButton />
    </Sheet>
  );
}
