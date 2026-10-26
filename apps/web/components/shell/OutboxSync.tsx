'use client';
// Replays the offline queue (lib/outbox.ts) through the same server actions as an online save, on load and
// whenever the browser comes back online; shows how many entries are still waiting. Also registers /sw.js
// (offline copies of visited pages + push).
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { createClient } from '@/lib/supabase/client';
import { runAct } from '@/app/actions/forms';
import { clearOfflineCopies, drop, OUTBOX_EVENT, pending } from '@/lib/outbox';
import { toast } from '@/components/ui/Toast';

export function OutboxSync() {
  const t = useTranslations('log');
  const router = useRouter();
  const [n, setN] = useState(0);

  useEffect(() => {
    const sb = createClient();
    let busy = false;
    const user = async () => (await sb.auth.getSession()).data.session?.user.id;
    const count = async () => { const u = await user(); setN(u ? (await pending(u).catch(() => [])).length : 0); };
    const flush = async () => {
      if (busy || !navigator.onLine) return void count();
      busy = true;
      let ok = 0;
      try {
        const u = await user();
        for (const q of u ? await pending(u) : []) {
          let r;
          try { r = await runAct(q.act, q.input); } catch { break; } // network still down: keep the rest queued
          await drop(q.id!);
          if (r.ok) ok++; else toast(t('syncFailed', { error: r.error })); // rejected (e.g. invalid): don't retry forever
        }
      } catch { /* IndexedDB unavailable (private mode) */ }
      busy = false;
      await count();
      if (ok) { toast(t('synced', { n: ok })); router.refresh(); }
    };
    navigator.serviceWorker?.register('/sw.js').catch(() => {});
    user().then((u) => { // another person signed in on this phone: drop the previous user's offline pages
      try { if (u && localStorage.getItem('hp-last-user') !== u) { clearOfflineCopies(); localStorage.setItem('hp-last-user', u); } } catch { /* storage blocked */ }
    });
    flush();
    window.addEventListener('online', flush);
    window.addEventListener(OUTBOX_EVENT, count);
    return () => { window.removeEventListener('online', flush); window.removeEventListener(OUTBOX_EVENT, count); };
  }, [router, t]);

  return n ? <div className="card stripe warn" role="status" data-testid="outbox">{t('pendingSync', { n })}</div> : null;
}
