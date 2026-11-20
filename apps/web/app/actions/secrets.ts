'use server';
// API keys and webhook secrets are returned ONCE by their RPCs (0051 create_api_key, 0052 create_webhook) and never stored or logged here.
import { z } from 'zod';
import { getTranslations } from 'next-intl/server';
import { createClient } from '@/lib/supabase/server';
import { claimsFromUser } from '@/lib/auth/claims';
import { canAct } from '@/lib/auth/permissions';
import { API_SCOPES, WEBHOOK_EVENTS } from '@/lib/schemas';

export type SecretResult = { ok: true; secret: string } | { ok: false; error: string };

const KEY = z.object({ name: z.string().trim().min(1).max(60), scopes: z.array(z.enum(API_SCOPES)).min(1) });
const HOOK = z.object({ url: z.string().trim().max(300).regex(/^https:\/\/[^\s/$.?#][^\s]*$/), events: z.array(z.enum(WEBHOOK_EVENTS)).min(1) });

async function run(act: 'createApiKey' | 'createWebhook', call: (sb: Awaited<ReturnType<typeof createClient>>) => PromiseLike<{ data: unknown; error: { message: string } | null }>): Promise<SecretResult> {
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user || !canAct(claimsFromUser(user).roles, act)) return { ok: false, error: (await getTranslations('forms'))('forbidden') };
  const { data, error } = await call(sb);
  if (error) return { ok: false, error: error.message };
  return { ok: true, secret: String(data) };
}

export async function createApiKey(input: unknown): Promise<SecretResult> {
  const p = KEY.safeParse(input);
  if (!p.success) return { ok: false, error: (await getTranslations('forms'))('invalid') };
  return run('createApiKey', (sb) => sb.rpc('create_api_key', { p_name: p.data.name, p_scopes: p.data.scopes }));
}

export async function createWebhook(input: unknown): Promise<SecretResult> {
  const p = HOOK.safeParse(input);
  if (!p.success) return { ok: false, error: (await getTranslations('forms'))('invalid') };
  return run('createWebhook', (sb) => sb.rpc('create_webhook', { p_url: p.data.url, p_events: p.data.events }));
}
