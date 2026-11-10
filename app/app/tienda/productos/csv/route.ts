import { NextResponse } from 'next/server';
import { getContext, can } from '@/lib/context';
import { kindLabel } from '@/lib/store';

/** Inventario completo en CSV (Excel): stock, costo, precio y valor. */
export async function GET() {
  const ctx = await getContext();
  if (!ctx.orgId || !(can(ctx, 'store.view') || can(ctx, 'store.create'))) return new NextResponse('No autorizado', { status: 403 });
  const { data } = await ctx.supabase.from('products').select('sku, barcode, name, kind, category, brand, unit, price, cost, stock, min_stock, online, active')
    .eq('organization_id', ctx.orgId).order('name');
  const q = (s: unknown) => `"${String(s ?? '').replace(/"/g, '""')}"`;
  const n = (x: unknown) => String(Number(x ?? 0)).replace('.', ',');
  const lines = ['Código;Código de barras;Producto;Tipo;Categoría;Marca;Unidad;Precio venta;Costo;Stock;Stock mínimo;Valor a costo;En web;Activo'];
  for (const p of data ?? []) lines.push([q(p.sku), q(p.barcode), q(p.name), q(kindLabel(p.kind)), q(p.category), q(p.brand), q(p.unit), n(p.price), n(p.cost), n(p.stock), n(p.min_stock),
    n(Math.max(0, Number(p.stock)) * Number(p.cost)), p.online ? 'Sí' : 'No', p.active ? 'Sí' : 'No'].join(';'));
  return new NextResponse('﻿' + lines.join('\r\n'), { headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="inventario.csv"', 'Cache-Control': 'no-store' } });
}
