import { describe, it, expect } from 'vitest';
import { pickLocale } from '@/lib/i18n/locales';

describe('pickLocale', () => {
  it('cookie wins', () => expect(pickLocale('ta', 'hi-IN,hi;q=0.9')).toBe('ta'));
  it('ignores unknown cookie, uses browser order', () => expect(pickLocale('fr', 'fr-FR,kn;q=0.8,te;q=0.9')).toBe('te'));
  it('maps regional tags', () => expect(pickLocale(undefined, 'hi-IN')).toBe('hi'));
  it('falls back to English', () => expect(pickLocale(undefined, 'de-DE,fr;q=0.8')).toBe('en'));
  it('handles missing header', () => expect(pickLocale(undefined, null)).toBe('en'));
});
