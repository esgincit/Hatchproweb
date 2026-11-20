'use client';
// New notification rows (daily-alerts, 0023 realtime) pop as a toast while the app is open and refresh the bell count.
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { toast } from '@/components/ui/Toast';

export function LiveAlerts() {
  const router = useRouter();
  useEffect(() => {
    const sb = createClient();
    let live = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const ch = sb.channel('alerts').on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notification' }, (p) => {
      toast(String((p.new as { title?: string }).title ?? ''));
      // a refresh that lands while a form's server action is in flight can leave that action unanswered (the form stays busy):
      // an alert is often raised by the very write being saved, so let the action finish first
      clearTimeout(timer);
      timer = setTimeout(() => router.refresh(), 1500);
    });
    // RLS needs the user's token on the socket before subscribing, or every event is filtered out
    sb.auth.getSession().then(({ data }) => { if (!live) return; sb.realtime.setAuth(data.session?.access_token ?? null);
      ch.subscribe((st) => { if (live) document.body.dataset.alerts = st === 'SUBSCRIBED' ? 'live' : 'off'; }); // e2e waits on this
    });
    return () => { live = false; clearTimeout(timer); sb.removeChannel(ch); };
  }, [router]);
  return null;
}
