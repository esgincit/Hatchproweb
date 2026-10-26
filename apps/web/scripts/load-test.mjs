// Small load test (roadmap Phase 13), no dependencies. Logs in once with a test OTP, then hammers the main
// screens with N concurrent users for D seconds and prints requests/s, p50/p95/p99 latency and errors.
// Run against a PRODUCTION build (pnpm build && pnpm start -p 3200), never the dev server:
//   node scripts/load-test.mjs http://localhost:3200 [users=20] [seconds=30]
// ponytail: one shared session cookie — enough to load-test rendering + RLS queries; per-user sessions when needed.
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';

const [base = 'http://localhost:3200', usersArg = '20', secsArg = '30'] = process.argv.slice(2);
const env = Object.fromEntries(readFileSync('.env.local', 'utf8').split('\n').filter((l) => l.includes('=') && !l.startsWith('#')).map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]));
if (!env.NEXT_PUBLIC_SUPABASE_URL.includes('127.0.0.1')) throw new Error('load test runs against local Supabase only');

const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
await sb.auth.signInWithOtp({ phone: '+919849012345' });
const { data, error } = await sb.auth.verifyOtp({ phone: '+919849012345', token: '123456', type: 'sms' });
if (error) throw error;
// same cookie the web app's @supabase/ssr client writes: sb-<host label>-auth-token = "base64-" + base64url(session),
// split into .0/.1… chunks above ~3180 chars
const name = `sb-${new URL(env.NEXT_PUBLIC_SUPABASE_URL).hostname.split('.')[0]}-auth-token`;
const value = 'base64-' + Buffer.from(JSON.stringify(data.session)).toString('base64url');
const chunks = value.length <= 3180 ? [[name, value]] : value.match(/.{1,3180}/g).map((c, i) => [`${name}.${i}`, c]);
const cookie = [...chunks.map(([k, v]) => `${k}=${v}`), 'NEXT_LOCALE=en'].join('; ');

const PAGES = ['/home', '/farm', '/log', '/money', '/more/reports'];
const lat = []; let errors = 0;
const end = Date.now() + Number(secsArg) * 1000;
async function user(i) {
  for (let n = i; Date.now() < end; n++) {
    const t0 = performance.now();
    try {
      const r = await fetch(base + PAGES[n % PAGES.length], { headers: { cookie }, redirect: 'manual' });
      await r.arrayBuffer();
      if (r.status !== 200) errors++;
    } catch { errors++; }
    lat.push(performance.now() - t0);
  }
}
await Promise.all(Array.from({ length: Number(usersArg) }, (_, i) => user(i)));
lat.sort((a, b) => a - b);
const q = (p) => Math.round(lat[Math.min(lat.length - 1, Math.floor(p * lat.length))]);
console.log(JSON.stringify({ users: Number(usersArg), seconds: Number(secsArg), requests: lat.length, rps: +(lat.length / Number(secsArg)).toFixed(1), p50: q(0.5), p95: q(0.95), p99: q(0.99), errors }));
