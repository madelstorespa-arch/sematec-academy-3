import { NextResponse, type NextRequest } from 'next/server';
import { getContext, can } from '@/lib/context';
import { GROUPS, bucketLabel, periodRange } from '@/lib/finance';

/** Balance en CSV (se abre en Excel): mes a mes, por programa y por sección. */
export async function GET(req: NextRequest) {
  const ctx = await getContext();
  if (!ctx.orgId || !can(ctx, 'finance.view')) return new NextResponse('No autorizado', { status: 403 });
  const sp = req.nextUrl.searchParams;
  const r = periodRange(sp.get('desde'), sp.get('hasta'), sp.get('por'));
  const { data, error } = await ctx.supabase.rpc('finance_report', { p_org: ctx.orgId, p_from: r.start, p_to: r.end, p_currency: sp.get('moneda') || null, p_group: r.group });
  const monthName = (m: string) => bucketLabel(m, r.group);
  if (error || !data) return new NextResponse(error?.message ?? 'Error', { status: 400 });
  const rep = data as any;
  const n = (x: number) => String(Math.round(Number(x) * 100) / 100).replace('.', ',');
  const q = (s: string) => `"${String(s ?? '').replace(/"/g, '""')}"`;
  const lines: string[] = [`${q('Balance')};${q(`${bucketLabel(r.start, 'day')} a ${bucketLabel(r.end, 'day')}`)};${q(rep.currency)};${q(GROUPS.find(([v]) => v === r.group)?.[2] ?? '')}`, ''];
  lines.push(`${GROUPS.find(([v]) => v === r.group)?.[1]};Ingresos;De la tienda;Egresos;Queda`);
  for (const m of rep.months) lines.push([q(monthName(m.m)), n(m.income), n(m.store ?? 0), n(m.expenses), n(m.income - m.expenses)].join(';'));
  lines.push(['Total', n(rep.income), n(rep.store_income ?? 0), n(rep.expenses), n(rep.income - rep.expenses)].map(String).join(';'), '');
  const block = (title: string, rows: any[], label: (x: any) => string) => {
    lines.push(`${title};Alumnos;${rep.months.map((m: any) => q(monthName(m.m))).join(';')};Ingresos;Gastos;Saldo`);
    for (const x of rows) lines.push([q(label(x)), x.students, ...rep.months.map((m: any) => n(x.months?.[m.m] ?? 0)), n(x.income), n(x.expenses), n(x.income - x.expenses)].join(';'));
    lines.push('');
  };
  block('Programa', rep.programs, (x) => x.name);
  block('Sección', rep.sections, (x) => `${x.name} · ${x.code}`);
  lines.push(`Pagos sin matrícula asociada;${n(rep.unassigned_income)}`, `Gastos generales;${n(rep.general_expenses)}`);
  return new NextResponse('﻿' + lines.join('\r\n'), {
    headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="balance-${r.start}-${r.end}.csv"`, 'Cache-Control': 'no-store' },
  });
}
