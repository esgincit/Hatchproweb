'use client';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { createClient } from '@/lib/supabase/client';

export function SignOutButton({ to = '/login' }: { to?: string }) {
  const t = useTranslations('common');
  const router = useRouter();
  return (
    <button className="btn secondary" type="button"
      onClick={async () => {
        await createClient().auth.signOut();
        // offline page copies belong to this user (sw.js); the outbox keeps entries tagged per user
        if ('caches' in window) await Promise.all((await caches.keys()).map((k) => caches.delete(k))).catch(() => {});
        router.replace(to); router.refresh();
      }}>
      {t('signOut')}
    </button>
  );
}
