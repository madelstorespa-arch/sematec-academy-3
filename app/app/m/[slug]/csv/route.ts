import { NextResponse } from 'next/server';
import { getContext } from '@/lib/context';
import { showValue, type CustomModule } from '@/lib/modules';

/** Registros de un módulo creado sin código, en CSV (Excel). */
export async function GET(_req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const ctx = await getContext();
  if (!ctx.orgId || !/^[a-z0-9-]{2,41}$/.test(slug)) return new NextResponse('No autorizado', { status: 403 });
  const { data: m } = await ctx.supabase.from('custom_modules').select('*').eq('organization_id', ctx.orgId).eq('slug', slug).maybeSingle();
  if (!m) return new NextResponse('No encontrado', { status: 404 });
  const mod = m as CustomModule;
  const { data: rows } = await ctx.supabase.from('custom_records').select('code, data, created_at').eq('module_id', mod.id).order('created_at').limit(50000);
  // Evita que Excel interprete un dato como fórmula
  const q = (s: unknown) => { let v = String(s ?? ''); if (/^[=+\-@\t\r]/.test(v)) v = `'${v}`; return `"${v.replace(/"/g, '""')}"`; };
  const lines = [['Código', ...mod.fields.map((f) => f.label), 'Creado'].map(q).join(';')];
  for (const r of rows ?? []) lines.push([q(r.code), ...mod.fields.map((f) => q(showValue(f, (r.data as any)?.[f.key]))), q(new Date(r.created_at).toLocaleString('es-CL'))].join(';'));
  return new NextResponse('﻿' + lines.join('\r\n'), {
    headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="${mod.slug}.csv"`, 'Cache-Control': 'no-store' },
  });
}
