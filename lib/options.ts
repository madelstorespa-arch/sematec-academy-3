import 'server-only';
import type { Ctx } from '@/lib/context';

type Opt = { value: string; label: string };
const map = (rows: any[] | null, l: (r: any) => string): Opt[] => (rows ?? []).map((r) => ({ value: r.id, label: l(r) }));

export async function campusOptions(ctx: Ctx): Promise<Opt[]> {
  const { data } = await ctx.supabase.from('campuses').select('id, name, code').eq('organization_id', ctx.orgId!).eq('status', 'active').order('name');
  return map(data, (r) => `${r.name} (${r.code})`);
}
export async function countryOptions(ctx: Ctx): Promise<Opt[]> {
  const { data } = await ctx.supabase.from('countries').select('code, name').order('name');
  return (data ?? []).map((r: any) => ({ value: r.code, label: r.name }));
}
export async function programOptions(ctx: Ctx): Promise<Opt[]> {
  const { data } = await ctx.supabase.from('programs').select('id, code, name').eq('organization_id', ctx.orgId!).eq('status', 'active').order('name');
  return map(data, (r) => `${r.code} · ${r.name}`);
}
export async function periodOptions(ctx: Ctx): Promise<Opt[]> {
  const { data } = await ctx.supabase.from('academic_periods').select('id, code, name').eq('organization_id', ctx.orgId!).order('starts_on', { ascending: false });
  return map(data, (r) => `${r.code} · ${r.name}`);
}
export async function courseOptions(ctx: Ctx): Promise<Opt[]> {
  const { data } = await ctx.supabase.from('courses').select('id, code, name').eq('organization_id', ctx.orgId!).eq('status', 'active').order('code');
  return map(data, (r) => `${r.code} · ${r.name}`);
}
export async function teacherOptions(ctx: Ctx): Promise<Opt[]> {
  const { data } = await ctx.supabase.from('teachers').select('id, first_names, last_names').eq('organization_id', ctx.orgId!).eq('status', 'active').order('last_names');
  return map(data, (r) => `${r.last_names}, ${r.first_names}`);
}
export async function studentOptions(ctx: Ctx): Promise<Opt[]> {
  const { data } = await ctx.supabase.from('students').select('id, student_code, first_names, last_names, id_document_number').eq('organization_id', ctx.orgId!).eq('status', 'active').order('last_names').limit(2000);
  return map(data, (r) => `${r.last_names}, ${r.first_names} (${r.student_code}${r.id_document_number ? ` · ${r.id_document_number}` : ''})`);
}
export async function gradeScaleOptions(ctx: Ctx): Promise<Opt[]> {
  const { data } = await ctx.supabase.from('grade_scales').select('id, name').eq('organization_id', ctx.orgId!).order('name');
  return map(data, (r) => r.name);
}
export async function roomOptions(ctx: Ctx): Promise<Opt[]> {
  const { data } = await ctx.supabase.from('rooms').select('id, code, name, capacity').eq('organization_id', ctx.orgId!).eq('status', 'active').order('code');
  return map(data, (r) => `${r.code} · ${r.name} (${r.capacity})`);
}
