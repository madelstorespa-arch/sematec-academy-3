import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { FILE_MAX, FILE_MAX_LABEL, FILE_TYPES } from '@/lib/user-files';

/** Autoriza subir un archivo: enlace firmado de un solo uso (el archivo va directo al almacenamiento privado). */
export async function POST(request: NextRequest) {
  const { org, size, mime } = await request.json().catch(() => ({}));
  if (typeof org !== 'string' || !/^[0-9a-f-]{36}$/i.test(org) || typeof size !== 'number' || size <= 0)
    return NextResponse.json({ error: 'Solicitud inválida' }, { status: 400 });
  if (size > FILE_MAX) return NextResponse.json({ error: `El archivo supera ${FILE_MAX_LABEL}, el máximo configurado por archivo.` }, { status: 413 });
  const type = String(mime ?? '').split(';')[0].toLowerCase();
  const ext = FILE_TYPES[type];
  if (!ext) return NextResponse.json({ error: 'Tipo de archivo no permitido. Suba fotos, videos, audio, PDF, Office, texto o ZIP.' }, { status: 415 });
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  const { data: member } = await supabase.from('memberships').select('id').eq('user_id', user.id).eq('organization_id', org).eq('status', 'active').limit(1);
  if (!member?.length) return NextResponse.json({ error: 'Sin acceso a la institución' }, { status: 403 });
  const path = `${org}/${user.id}/${crypto.randomUUID()}.${ext}`;
  const { data, error } = await createAdminClient().storage.from('user-files').createSignedUploadUrl(path);
  if (error || !data) return NextResponse.json({ error: `El almacenamiento no está disponible: ${error?.message ?? ''}` }, { status: 502 });
  return NextResponse.json({ path, token: data.token }, { headers: { 'Cache-Control': 'no-store' } });
}
