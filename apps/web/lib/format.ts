const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export const fmtINR = (n: number) => '₹' + Math.round(n).toLocaleString('en-IN');
export const fmtL = (n: number) => (Math.abs(n) >= 1e5 ? '₹' + (n / 1e5).toFixed(2) + ' L' : fmtINR(n));
export const fmtN = (n: number) => Math.round(n).toLocaleString('en-IN');
export const dmy = (s: string) => {
  const [, m, d] = s.split('-');
  return `${+d} ${MON[+m - 1]}`;
};
export const addDays = (s: string, n: number) => {
  const d = new Date(s + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
export const daysBetween = (a: string, b: string) => Math.round((+new Date(b) - +new Date(a)) / 864e5);
