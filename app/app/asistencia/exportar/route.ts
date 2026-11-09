import { NextResponse, type NextRequest } from 'next/server';
import { getContext } from '@/lib/context';
import { studentReport, teacherReport, staffReport } from '../data';

const cell = (v: unknown) => {
  const s = v === null || v === undefined ? '' : String(v);
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s; // evita fórmulas al abrir en Excel
  return /[";\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};

/** ⬇ Descarga la asistencia en CSV (se abre directo en Excel). */
export async function GET(req: NextRequest) {
  const ctx = await getContext();
  if (!ctx.orgId) return new NextResponse('Sin institución', { status: 403 });
  const p = req.nextUrl.searchParams;
  const f = { desde: p.get('desde') ?? undefined, hasta: p.get('hasta') ?? undefined, seccion: p.get('seccion') ?? undefined };
  const tipo = p.get('tipo') ?? 'estudiantes';
  let head: string[] = []; let rows: unknown[][] = []; let error: { message: string } | null = null;
  if (tipo === 'profesores') {
    const r = await teacherReport(ctx, f); error = r.error;
    head = ['Profesor', 'Clases programadas', 'Dictadas', 'Suspendidas', 'Pendientes', 'Horas dictadas', 'Última clase'];
    rows = r.rows.map((x) => [x.teacher_name, x.scheduled, x.held, x.cancelled, x.pending, x.hours, x.last_class]);
  } else if (tipo === 'personal') {
    const r = await staffReport(ctx, f); error = r.error;
    head = ['Funcionario', 'Cargo', 'Días con marcaje', 'Días sin salida', 'Horas', 'Primera entrada', 'Última salida'];
    rows = r.rows.map((x) => [x.employee_name, x.job_title, x.days, x.open_days, x.hours, x.first_in, x.last_out]);
  } else {
    const r = await studentReport(ctx, f); error = r.error;
    head = ['Asignatura y sección', 'Código', 'Estudiante', 'Clases', 'Presente', 'Atraso', 'Ausente', 'Justificado', 'Asistencia %', 'Mínimo %', 'Bajo el mínimo'];
    rows = r.rows.map((x) => [x.section_label, x.student_code, x.student_name, x.sessions, x.present, x.late, x.absent, x.excused, x.pct, x.min_pct, x.below ? 'SÍ' : 'no']);
  }
  if (error) return new NextResponse(error.message, { status: 403 });
  const csv = '﻿' + [head, ...rows].map((r) => r.map(cell).join(';')).join('\r\n');
  return new NextResponse(csv, {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="asistencia-${tipo}-${new Date().toISOString().slice(0, 10)}.csv"`,
      'cache-control': 'no-store',
    },
  });
}
