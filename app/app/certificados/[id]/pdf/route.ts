import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { certificatePdf } from '@/lib/certificate-pdf';
import { env } from '@/lib/env';
import { fmtDate } from '@/lib/format';

export const runtime = 'nodejs';

/** Descarga del certificado en PDF: solo quien puede verlo (RLS: el titular o personal con permiso). */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return new NextResponse('No encontrado', { status: 404 });
  const sb = await createClient();
  const { data: c } = await sb.from('certificates').select('*, certificate_templates(body_template)').eq('id', id).maybeSingle();
  if (!c) return new NextResponse('No encontrado', { status: 404 });
  const admin = createAdminClient();
  const [{ data: org }, { data: site }] = await Promise.all([
    admin.from('organizations').select('legal_name, display_name').eq('id', c.organization_id).maybeSingle(),
    admin.from('site_settings').select('logo_asset_id').eq('organization_id', c.organization_id).maybeSingle(),
  ]);
  let logo: Uint8Array | null = null, logoMime: string | null = null;
  if (site?.logo_asset_id) {
    const { data: m } = await admin.from('media_assets').select('bytes, mime_type').eq('id', site.logo_asset_id).maybeSingle();
    if (m) { logo = Buffer.from(String(m.bytes).replace(/^\\x/, ''), 'hex'); logoMime = m.mime_type; }
  }
  const P = c.payload ?? {};
  const body: string = P.body ?? (c.certificate_templates?.body_template || '').replaceAll('{{name}}', c.recipient_name)
    .replaceAll('{{program}}', P.program ?? '').replaceAll('{{course}}', P.course ?? '').replaceAll('{{grade}}', P.final_grade ?? '').replaceAll('{{date}}', '');
  const orgName = org?.display_name || P.organization || '';
  const bytes = await certificatePdf({
    orgName, legalName: org?.legal_name && org.legal_name !== orgName ? org.legal_name : null,
    title: c.title, subtitle: P.subtitle, recipient: c.recipient_name, body, program: P.program, course: P.course, grade: P.final_grade,
    extra: P.extra, dateLine: `${P.city ? `${P.city}, ` : 'Emitido el '}${fmtDate(c.issued_at)} - Certificado N° ${c.serial_number}`,
    signers: P.signers ?? [], footer: P.footer, url: `${env.siteUrl()}/verificar/${c.verification_code}`, code: c.verification_code,
    hash: c.content_hash, revoked: c.status === 'revoked', logo, logoMime,
  });
  const name = `Certificado-${c.serial_number}-${c.recipient_name}`.normalize('NFD').replace(/[^\w-]+/g, '_').slice(0, 80);
  const inline = req.nextUrl.searchParams.get('ver') === '1';
  return new NextResponse(new Uint8Array(bytes), {
    headers: {
      'Content-Type': 'application/pdf', 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff',
      'Content-Disposition': `${inline ? 'inline' : 'attachment'}; filename="${name}.pdf"`,
    },
  });
}
