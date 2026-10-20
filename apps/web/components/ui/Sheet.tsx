'use client';
import * as Dialog from '@radix-ui/react-dialog';

/** Demo bottom sheet (phone) / 480px right drawer (≥768px). Radix gives focus trap + Esc + aria. */
export function Sheet({ open, onOpenChange, title, children }: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="sheet" />
        <Dialog.Content className="sheet-panel" aria-describedby={undefined}>
          <Dialog.Title className="eyebrow">{title}</Dialog.Title>
          {children}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
