import { describe, it, expect } from 'vitest';
import { claimsFromUser } from '@/lib/auth/claims';
import { tabsFor } from '@/lib/auth/permissions';
import { redirectFor, landingFor } from '@/lib/auth/route-guard';

const owner = { tenantId: 't1', roles: ['tenant_owner'], platform: false };
const sup = { tenantId: 't1', roles: ['shed_supervisor'], platform: false };
const labour = { tenantId: 't1', roles: ['labour'], platform: false };
const admin = { tenantId: null, roles: ['platform_admin'], platform: true };
const orphan = { tenantId: 't1', roles: [], platform: false };

describe('claimsFromUser', () => {
  it('reads app_metadata', () =>
    expect(claimsFromUser({ app_metadata: { tenant_id: 't1', roles: ['finance'], platform: false } }))
      .toEqual({ tenantId: 't1', roles: ['finance'], platform: false }));
  it('is safe on missing/garbage metadata', () => {
    expect(claimsFromUser(null)).toEqual({ tenantId: null, roles: [], platform: false });
    expect(claimsFromUser({ app_metadata: { tenant_id: '', roles: 'x', platform: 'true' } }))
      .toEqual({ tenantId: null, roles: [], platform: false });
  });
});

describe('tabsFor', () => {
  it('owner sees all five', () => expect(tabsFor(['tenant_owner'])).toEqual(['home', 'farm', 'log', 'money', 'more']));
  it('supervisor has no Money', () => expect(tabsFor(['shed_supervisor'])).toEqual(['home', 'farm', 'log', 'more']));
  it('finance', () => expect(tabsFor(['finance'])).toEqual(['home', 'money', 'more']));
  it('unions roles in tab order', () => expect(tabsFor(['finance', 'labour'])).toEqual(['home', 'log', 'money', 'more']));
  it('unknown role sees nothing', () => expect(tabsFor(['nope'])).toEqual([]));
});

describe('redirectFor', () => {
  it('anonymous', () => {
    expect(redirectFor('/home', null)).toBe('/login');
    expect(redirectFor('/admin', null)).toBe('/platform/login');
    expect(redirectFor('/login', null)).toBeNull();
    expect(redirectFor('/platform/login', null)).toBeNull();
  });
  it('platform staff stay in /admin', () => {
    expect(redirectFor('/home', admin)).toBe('/admin');
    expect(redirectFor('/admin/tenants', admin)).toBeNull();
    expect(redirectFor('/apply', admin)).toBeNull();
  });
  it('tenant users cannot open /admin or login pages', () => {
    expect(redirectFor('/admin', owner)).toBe('/home');
    expect(redirectFor('/login', owner)).toBe('/home');
  });
  it('tab gating', () => {
    expect(redirectFor('/money', sup)).toBe('/home');
    expect(redirectFor('/money/ap', sup)).toBe('/home');
    expect(redirectFor('/farm', sup)).toBeNull();
    expect(redirectFor('/home', labour)).toBe('/log');
  });
  it('welcome reachable', () => expect(redirectFor('/welcome', sup)).toBeNull());
  it('no loop for a user without roles', () => {
    expect(landingFor(orphan)).toBe('/login?error=no-access');
    expect(redirectFor('/home', orphan)).toBe('/login?error=no-access');
    expect(redirectFor('/login', orphan)).toBeNull();
  });
});

import { canAct, ACT_ROLES } from '@/lib/auth/permissions';
import { SCHEMAS } from '@/lib/schemas';
describe('canAct', () => {
  it('every form action has a role list', () => expect(Object.keys(SCHEMAS).filter((a) => !ACT_ROLES[a])).toEqual([]));
  it('supervisor cannot pay or sell, can log and record mortality', () => {
    expect(canAct(['shed_supervisor'], 'payOpen')).toBe(false);
    expect(canAct(['shed_supervisor'], 'saleOpen')).toBe(false);
    expect(canAct(['shed_supervisor'], 'logSave')).toBe(true);
    expect(canAct(['shed_supervisor'], 'mort')).toBe(true);
  });
  it('finance handles money only', () => {
    expect(canAct(['finance'], 'payOpen')).toBe(true);
    expect(canAct(['finance'], 'addBatch')).toBe(false);
  });
  it('labour logs but cannot mark attendance', () => {
    expect(canAct(['labour'], 'logSave')).toBe(true);
    expect(canAct(['labour'], 'attSet')).toBe(false);
  });
  it('no roles, no actions', () => expect(canAct([], 'logSave')).toBe(false));
});
