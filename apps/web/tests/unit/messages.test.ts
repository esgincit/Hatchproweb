import { describe, it, expect } from 'vitest';
import { LOCALES } from '@/lib/i18n/locales';
import en from '@/messages/en.json';
import te from '@/messages/te.json';
import hi from '@/messages/hi.json';
import ta from '@/messages/ta.json';
import kn from '@/messages/kn.json';

type Tree = { [k: string]: string | Tree };
const ALL: Record<string, Tree> = { en, te, hi, ta, kn };
const flat = (t: Tree, p = ''): Record<string, string> =>
  Object.entries(t).reduce((acc, [k, v]) => (typeof v === 'string' ? { ...acc, [p + k]: v } : { ...acc, ...flat(v, p + k + '.') }), {});
// top-level ICU argument names: {name}, {n, plural, ...}
const args = (s: string) => [...s.matchAll(/\{(\w+)[,}]/g)].map((m) => m[1]).sort().join(',');

describe('message catalogues', () => {
  const base = flat(en);
  it('has a file for every locale', () => expect(Object.keys(ALL).sort()).toEqual([...LOCALES].sort()));
  for (const loc of LOCALES.filter((l) => l !== 'en')) {
    const m = flat(ALL[loc]);
    it(`${loc}: same keys as en`, () => {
      expect(Object.keys(base).filter((k) => !(k in m)), 'missing').toEqual([]);
      expect(Object.keys(m).filter((k) => !(k in base)), 'extra').toEqual([]);
    });
    it(`${loc}: same placeholders as en`, () => {
      const bad = Object.keys(base).filter((k) => k in m && args(base[k]) !== args(m[k]));
      expect(bad).toEqual([]);
    });
    it(`${loc}: nothing left in English by mistake`, () => {
      // brand/tech tokens are allowed to stay identical
      const same = Object.keys(base).filter((k) => m[k] === base[k] && /[a-z]{4,}/.test(base[k].replace(/{[^}]*}/g, '').replace(/HatchPro|NECC|FCR|GST|GSTR-1|JSON|XML|Tally|WhatsApp|OTP|PDF|Excel|MRR|DOC|PO|CV|AI|AP|AR|OK/g, '')));
      expect(same).toEqual([]);
    });
  }
});
