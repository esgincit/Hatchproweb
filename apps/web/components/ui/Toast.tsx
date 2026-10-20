'use client';
import { useEffect, useState } from 'react';

/** Demo toast (demo/index.html:176). Fire from anywhere on the client: toast('Saved'). */
export const toast = (msg: string) => window.dispatchEvent(new CustomEvent('hp-toast', { detail: msg }));

export function Toaster() {
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => {
    let h: ReturnType<typeof setTimeout>;
    const on = (e: Event) => {
      setMsg((e as CustomEvent<string>).detail);
      clearTimeout(h);
      h = setTimeout(() => setMsg(null), 2800);
    };
    window.addEventListener('hp-toast', on);
    return () => window.removeEventListener('hp-toast', on);
  }, []);
  return (
    <div className="toast" role="status" aria-live="polite" hidden={!msg}>
      {msg}
    </div>
  );
}
