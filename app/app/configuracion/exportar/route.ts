import { NextResponse } from 'next/server';
import { getContext } from '@/lib/context';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/** Tablas que se exportan (todas con organization_id; las protege la seguridad por filas de la base). */
const TABLES = [
  'campuses', 'site_settings', 'organization_settings', 'roles', 'memberships', 'user_permissions',
  'conference_rooms', 'conference_sessions', 'conference_participants', 'conference_attendance', 'conference_recordings', 'conference_guests', 'conference_invites',
  'students', 'teachers', 'employees', 'programs', 'courses', 'sections', 'section_enrollments', 'class_sessions', 'attendance_records', 'grades', 'assessments',
  'course_units', 'course_contents', 'class_materials', 'assignments', 'submissions', 'quizzes', 'forum_threads', 'forum_posts',
  'announcements', 'calendar_events', 'surveys', 'library_items', 'documents', 'file_folders', 'user_files', 'custom_modules', 'custom_records',
  'external_evaluations', 'support_tickets', 'certificates',
];
const MAX = 20000;

/** 📦 Copia de los datos de la organización activa (solo propietario). */
export async function GET() {
  const ctx = await getContext();
  if (!ctx.orgId || !(ctx.isOwner)) return new NextResponse('No autorizado', { status: 404 });
  const sb = ctx.supabase;
  const { data: org } = await sb.from('organizations').select('id, slug, legal_name, display_name, tax_id, country_code, base_currency, default_locale, timezone, platform_mode, org_kind, status, created_at').eq('id', ctx.orgId).maybeSingle();
  const out: Record<string, unknown> = {
    formato: 'sematec-export/1', exportado: new Date().toISOString(), por: ctx.user.email, organizacion: org, tablas: {} as Record<string, unknown>, avisos: [] as string[],
  };
  const tablas = out.tablas as Record<string, unknown>; const avisos = out.avisos as string[];
  await Promise.all(TABLES.map(async (t) => {
    try {
      // Los archivos se exportan como fichas (sin el contenido binario)
      const { data, error } = await sb.from(t).select('*').eq('organization_id', ctx.orgId!).limit(MAX);
      if (error) { avisos.push(`${t}: ${error.message}`); return; }
      const rows = (data ?? []).map((r: Record<string, unknown>) => { const c = { ...r }; delete c.bytes; delete c.content; return c; });
      tablas[t] = rows;
      if (rows.length >= MAX) avisos.push(`${t}: se exportaron las primeras ${MAX} filas`);
    } catch (e) { avisos.push(`${t}: ${(e as Error).message}`); }
  }));
  const name = `${org?.slug ?? 'organizacion'}-datos-${new Date().toISOString().slice(0, 10)}.json`;
  return new NextResponse(JSON.stringify(out, null, 1), {
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Content-Disposition': `attachment; filename="${name}"`, 'Cache-Control': 'no-store' },
  });
}
