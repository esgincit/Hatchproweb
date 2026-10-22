// Downloads behind the demo's export buttons. RLS scopes every query to the caller's tenant;
// the role check mirrors who sees the button.
import { createClient } from '@/lib/supabase/server';
import { claimsFromUser } from '@/lib/auth/claims';
import { loadView, todayIST } from '@/lib/view/load';
import { attMonth, batchKpi, rate } from '@/lib/kpi';

const MONEY = ['tenant_owner', 'farm_manager', 'finance', 'auditor'];
const PEOPLE = ['tenant_owner', 'farm_manager', 'finance', 'shed_supervisor'];
const KINDS: Record<string, string[]> = { tally: MONEY, gstr1: MONEY, statements: MONEY, pnl: MONEY, register: PEOPLE };

// Text cells starting with = + - @ or a control char would run as formulas in Excel (CSV injection): prefix '.
const cell = (v: string | number | null | undefined) => {
  if (typeof v === 'number') return String(v);
  let s = String(v ?? '');
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const csv = (rows: (string | number | null | undefined)[][]) => '﻿' + rows.map((r) => r.map(cell).join(',')).join('\r\n');
const xml = (s: string) => s.replace(/[<>&'"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' })[c]!);

export async function GET(_req: Request, { params }: { params: Promise<{ kind: string }> }) {
  const { kind } = await params;
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return new Response('unauthorized', { status: 401 });
  const roles = claimsFromUser(user).roles;
  if (!KINDS[kind]) return new Response('not found', { status: 404 });
  if (!KINDS[kind].some((r) => roles.includes(r))) return new Response('forbidden', { status: 403 });

  const v = await loadView();
  const { t, today } = v;
  const month = (todayIST() ?? today).slice(0, 7);
  const file = (body: string, name: string, type: string) =>
    new Response(body, { headers: { 'Content-Type': type, 'Content-Disposition': `attachment; filename="${name}"` } });
  const slug = t.name.replace(/\W+/g, '-').toLowerCase();

  switch (kind) {
    case 'tally': {
      // Tally ERP 9 / Prime import: sales vouchers for invoices, purchase vouchers for bills, this month.
      const v1 = t.invoices.filter((i) => i.date.startsWith(month)).map((i) => voucher('Sales', i.no, i.date, i.customer, 'Sales Account', i.total));
      const v2 = t.bills.filter((b) => b.date.startsWith(month)).map((b) => voucher('Purchase', b.no, b.date, b.vendor, `Purchase - ${b.category}`, b.total));
      const body = `<?xml version="1.0" encoding="UTF-8"?>\n<ENVELOPE><HEADER><TALLYREQUEST>Import Data</TALLYREQUEST></HEADER><BODY><IMPORTDATA>` +
        `<REQUESTDESC><REPORTNAME>Vouchers</REPORTNAME></REQUESTDESC><REQUESTDATA>${[...v1, ...v2].join('')}</REQUESTDATA></IMPORTDATA></BODY></ENVELOPE>\n`;
      return file(body, `${slug}-tally-${month}.xml`, 'application/xml');
    }
    case 'gstr1': {
      // GSTR-1 working file: B2C/B2B invoice list with HSN-free summary (eggs/live birds are nil-rated).
      const inv = t.invoices.filter((i) => i.date.startsWith(month));
      const body = JSON.stringify({
        fp: month.slice(5) + month.slice(0, 4), generated_on: today, business: t.name,
        invoices: inv.map((i) => ({ inum: i.no, idt: i.date, party: i.customer, product: i.product, qty: i.qty, unit: i.unit, rate: i.rate, val: i.total, nil_rated: i.product !== 'manure' })),
        totals: { count: inv.length, value: inv.reduce((a, i) => a + i.total, 0), nil_rated: inv.filter((i) => i.product !== 'manure').reduce((a, i) => a + i.total, 0) },
      }, null, 2);
      return file(body, `${slug}-gstr1-${month}.json`, 'application/json');
    }
    case 'statements': {
      const rows: (string | number)[][] = [['Type', 'Party', 'Document', 'Date', 'Due', 'Total', 'Paid', 'Outstanding', 'Status']];
      for (const i of t.invoices) rows.push(['Receivable', i.customer, i.no, i.date, i.due, i.total, i.paid, i.total - i.paid, i.status]);
      for (const b of t.bills) rows.push(['Payable', b.vendor, b.no, b.date, b.due, b.total, b.paid, b.total - b.paid, b.status]);
      return file(csv(rows), `${slug}-statements-${today}.csv`, 'text/csv; charset=utf-8');
    }
    case 'register': {
      const [y, m] = today.split('-');
      const days = new Date(+y, +m, 0).getDate();
      const head = ['Worker', 'Role', ...Array.from({ length: days }, (_, i) => String(i + 1)), 'P', 'H', 'A', 'L', 'Payable days', 'Gross ₹', 'Advances ₹', 'Net ₹'];
      const rows: (string | number)[][] = [head];
      for (const w of t.workers) {
        const a = attMonth(t, w.id, today);
        const daysRow = Array.from({ length: days }, (_, i) => t.attendance[w.id]?.[`${y}-${m}-${String(i + 1).padStart(2, '0')}`] ?? '');
        const gross = Math.round((w.wage * a.payable) / a.days);
        const adv = t.advances.filter((x) => x.worker_id === w.id).reduce((s, x) => s + x.amount, 0);
        rows.push([w.name, w.role, ...daysRow, a.P, a.H, a.A, a.L, a.payable, gross, adv, gross - adv]);
      }
      return file(csv(rows), `${slug}-attendance-${y}-${m}.csv`, 'text/csv; charset=utf-8');
    }
    case 'pnl': {
      const rows: (string | number | null)[][] = [['Batch', 'Shed', 'Type', 'State', 'Chick cost', 'Bills', 'Revenue', 'Live value', 'Margin', 'FCR']];
      for (const b of t.batches) {
        const k = batchKpi(b);
        const bills = t.bills.filter((x) => x.batch === b.code).reduce((a, x) => a + x.total, 0);
        const rev = t.invoices.filter((x) => x.batch === b.code).reduce((a, x) => a + x.total, 0);
        const live = b.ft === 'broiler' && k.last?.avg_w && b.state !== 'closed' ? Math.round(((k.alive * k.last.avg_w) / 1000) * rate(v, 'broiler_farmgate')) : 0;
        rows.push([b.code, b.shed_name, b.ft, b.state, b.doc * b.doc_rate, bills, rev, live, rev + live - b.doc * b.doc_rate - bills, k.fcr ? k.fcr.toFixed(2) : null]);
      }
      return file(csv(rows), `${slug}-batch-pnl-${today}.csv`, 'text/csv; charset=utf-8');
    }
  }
  return new Response('not found', { status: 404 });
}

function voucher(type: 'Sales' | 'Purchase', no: string, date: string, party: string, ledger: string, amount: number) {
  const d = date.replace(/-/g, '');
  const partySign = type === 'Sales' ? 'Yes' : 'No'; // party is debited on sales, credited on purchases
  return `<TALLYMESSAGE xmlns:UDF="TallyUDF"><VOUCHER VCHTYPE="${type}" ACTION="Create"><DATE>${d}</DATE><VOUCHERTYPENAME>${type}</VOUCHERTYPENAME>` +
    `<VOUCHERNUMBER>${xml(no)}</VOUCHERNUMBER><PARTYLEDGERNAME>${xml(party)}</PARTYLEDGERNAME>` +
    `<ALLLEDGERENTRIES.LIST><LEDGERNAME>${xml(party)}</LEDGERNAME><ISDEEMEDPOSITIVE>${partySign}</ISDEEMEDPOSITIVE><AMOUNT>${type === 'Sales' ? -amount : amount}</AMOUNT></ALLLEDGERENTRIES.LIST>` +
    `<ALLLEDGERENTRIES.LIST><LEDGERNAME>${xml(ledger)}</LEDGERNAME><ISDEEMEDPOSITIVE>${partySign === 'Yes' ? 'No' : 'Yes'}</ISDEEMEDPOSITIVE><AMOUNT>${type === 'Sales' ? amount : -amount}</AMOUNT></ALLLEDGERENTRIES.LIST>` +
    `</VOUCHER></TALLYMESSAGE>`;
}
