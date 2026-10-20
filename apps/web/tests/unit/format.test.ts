import { describe, it, expect } from 'vitest';
import { fmtINR, fmtL, fmtN, dmy, addDays, daysBetween } from '@/lib/format';

describe('format (ported from demo/index.html:153-160)', () => {
  it('rupees in Indian grouping', () => expect(fmtINR(124500)).toBe('₹1,24,500'));
  it('lakhs from 1e5', () => { expect(fmtL(296000)).toBe('₹2.96 L'); expect(fmtL(99999)).toBe('₹99,999'); });
  it('counts', () => expect(fmtN(65432.4)).toBe('65,432'));
  it('day-month', () => expect(dmy('2026-10-19')).toBe('19 Oct'));
  it('addDays across months', () => expect(addDays('2026-10-19', 14)).toBe('2026-11-02'));
  it('daysBetween', () => expect(daysBetween('2026-10-19', '2026-11-02')).toBe(14));
});

import { dateFmt, monthFmt } from '@/lib/format';
describe('localised dates', () => {
  it('English keeps the demo format', () => expect(dateFmt('en')('2026-10-19')).toBe('19 Oct'));
  it('Hindi uses Devanagari month names', () => expect(dateFmt('hi')('2026-10-19')).toMatch(/19 अक्टू/));
  it('month name per locale', () => {
    expect(monthFmt('en', 'long')('2026-10-19')).toBe('October');
    expect(monthFmt('te', 'long')('2026-10-19')).toBe('అక్టోబర్');
  });
});
