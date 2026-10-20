'use client';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';

export function SignOutButton({ to = '/login' }: { to?: string }) {
  const router = useRouter();
  return (
    <button className="btn secondary" type="button"
      onClick={async () => { await createClient().auth.signOut(); router.replace(to); router.refresh(); }}>
      Sign out
    </button>
  );
}
