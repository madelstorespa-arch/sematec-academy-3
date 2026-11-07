import 'server-only';
import { notFound } from 'next/navigation';
import { can, type Ctx } from '@/lib/context';

export async function loadSection(ctx: Ctx, id: string) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const { data: s } = await ctx.supabase.from('sections')
    .select('id, code, organization_id, teacher_id, courses(code, name), academic_periods(name), teachers(first_names, last_names)').eq('id', id).maybeSingle();
  if (!s) notFound();
  const manager = (!!ctx.teacherId && s.teacher_id === ctx.teacherId) || can(ctx, 'sections.edit');
  const { data: enr } = ctx.studentId
    ? await ctx.supabase.from('section_enrollments').select('id').eq('section_id', id).eq('student_id', ctx.studentId).neq('status', 'dropped').maybeSingle()
    : { data: null };
  const student = !!enr;
  if (!manager && !student && !can(ctx, 'sections.view')) notFound();
  return { s: s as any, manager, student };
}
