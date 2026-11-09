import 'server-only';
import type { getContext } from '@/lib/context';

type Ctx = Awaited<ReturnType<typeof getContext>>;
export type Filters = { desde?: string; hasta?: string; seccion?: string };
const d = (v?: string) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);
const u = (v?: string) => (v && /^[0-9a-f-]{36}$/i.test(v) ? v : null);

export async function studentReport(ctx: Ctx, f: Filters) {
  const { data, error } = await ctx.supabase.rpc('attendance_student_report', { p_org: ctx.orgId, p_from: d(f.desde), p_to: d(f.hasta), p_section: u(f.seccion) });
  return { rows: (data ?? []) as any[], error };
}
export async function teacherReport(ctx: Ctx, f: Filters) {
  const { data, error } = await ctx.supabase.rpc('attendance_teacher_report', { p_org: ctx.orgId, p_from: d(f.desde), p_to: d(f.hasta) });
  return { rows: (data ?? []) as any[], error };
}
export async function staffReport(ctx: Ctx, f: Filters) {
  const { data, error } = await ctx.supabase.rpc('attendance_staff_report', { p_org: ctx.orgId, p_from: d(f.desde), p_to: d(f.hasta) });
  return { rows: (data ?? []) as any[], error };
}
