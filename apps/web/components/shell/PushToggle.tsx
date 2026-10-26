'use client';
// "Get alerts on this phone": registers /sw.js, subscribes to Web Push with the app's VAPID key and stores the
// subscription (push_subscription, RLS: own rows). daily-alerts pushes critical alerts to it.
// iPhone: push works only after Share → Add to Home Screen (iOS 16.4+).
import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { createClient } from '@/lib/supabase/client';
import { toast } from '@/components/ui/Toast';

const KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
const b64 = (s: string) => Uint8Array.from(atob((s + '='.repeat((4 - (s.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
type State = 'loading' | 'unsupported' | 'denied' | 'off' | 'on';

export function PushToggle() {
  const t = useTranslations('push');
  const [st, setSt] = useState<State>('loading');

  useEffect(() => {
    if (!KEY || !('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) return setSt('unsupported');
    if (Notification.permission === 'denied') return setSt('denied');
    navigator.serviceWorker.getRegistration('/').then((r) => r?.pushManager.getSubscription()).then((s) => setSt(s ? 'on' : 'off'), () => setSt('off'));
  }, []);

  async function on() {
    setSt('loading');
    try {
      if ((await Notification.requestPermission()) !== 'granted') return setSt('denied');
      const reg = await navigator.serviceWorker.register('/sw.js');
      await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64(KEY!) });
      const j = sub.toJSON();
      const { error } = await createClient().from('push_subscription').upsert({ endpoint: j.endpoint!, p256dh: j.keys!.p256dh, auth: j.keys!.auth }, { onConflict: 'endpoint' });
      if (error) { await sub.unsubscribe(); throw error; }
      setSt('on'); toast(t('ok'));
    } catch { setSt('off'); toast(t('failed')); }
  }

  async function off() {
    setSt('loading');
    const sub = await (await navigator.serviceWorker.getRegistration('/'))?.pushManager.getSubscription();
    if (sub) { await createClient().from('push_subscription').delete().eq('endpoint', sub.endpoint); await sub.unsubscribe(); }
    setSt('off');
  }

  if (st === 'unsupported' || st === 'denied') return <div className="card"><div className="s">{t(st)}</div></div>;
  return (
    <div className="card row between">
      <div className="s">{st === 'on' ? t('enabled') : t('why')}</div>
      {st === 'on'
        ? <button className="btn small secondary" onClick={off}>{t('turnOff')}</button>
        : <button className="btn small" disabled={st === 'loading'} onClick={on}>{t('turnOn')}</button>}
    </div>
  );
}
