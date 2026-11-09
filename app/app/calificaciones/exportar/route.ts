import { NextResponse, type NextRequest } from 'next/server';
import { getContext } from '@/lib/context';
import { aggregate, gradesReport } from '../data';

const cell = (v: unknown) => {
  const s = v === null || v === undefined ? '' : typeof v === 'number' ? v.toFixed(2).replace('.', ',') : String(v);
  const safe = /^[=+\-@\t\r]/.test(s) && typeof v !== 'number' ? `'${s}` : s;
  return /[";\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};

/** ⬇ Calificaciones en CSV (abre en Excel). */
export async function GET(req: NextRequest) {
  const ctx = await getContext();
  if (!ctx.orgId) return new NextResponse('Sin institución', { status: 403 });
  const p = req.nextUrl.searchParams;
  const { rows, error } = await gradesReport(ctx, { periodo: p.get('periodo') ?? undefined, seccion: p.get('seccion') ?? undefined });
  if (error) return new NextResponse(error.message, { status: 403 });
  const tipo = p.get('tipo') ?? 'detalle';
  const a = aggregate(rows);
  let out: unknown[][];
  if (tipo === 'estudiantes') out = [['Código', 'Estudiante', 'Carrera', 'Asignaturas', 'Con nota', 'Promedio general', 'En riesgo'],
    ...a.students.map((s) => [s.code, s.name, s.program, s.courses, s.graded, s.gpa, s.failing])];
  else if (tipo === 'asignaturas') out = [['Asignatura', 'Periodo', 'Estudiantes', 'Con nota', 'Promedio', 'Aprobando', 'En riesgo'],
    ...a.sections.map((s) => [s.label, s.period, s.students, s.graded, s.avg, s.approved, s.risk])];
  else out = [['Asignatura', 'Periodo', 'Carrera', 'Código', 'Estudiante', 'Ponderación evaluada %', 'Promedio parcial', 'Nota final', 'Nota de aprobación', 'En riesgo'],
    ...rows.map((r) => [r.section_label, r.period_code, r.program_name, r.student_code, r.student_name, r.graded_weight, r.average != null ? Number(r.average) : null,
      r.final_grade != null ? Number(r.final_grade) : null, Number(r.passing_grade), r.at_risk ? 'SÍ' : 'no'])];
  const csv = '﻿' + out.map((r) => r.map(cell).join(';')).join('\r\n');
  return new NextResponse(csv, { headers: { 'content-type': 'text/csv; charset=utf-8',
    'content-disposition': `attachment; filename="calificaciones-${tipo}-${new Date().toISOString().slice(0, 10)}.csv"`, 'cache-control': 'no-store' } });
}
