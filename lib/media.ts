import 'server-only';
import crypto from 'node:crypto';
import { createAdminClient } from '@/lib/supabase/admin';

const MAX = 3 * 1024 * 1024;

/** Detecta el tipo real por la firma del archivo (no confía en la extensión ni en el navegador). */
function sniff(b: Buffer): string | null {
  if (b.length > 8 && b[0] === 0x89 && b.toString('ascii', 1, 4) === 'PNG') return 'image/png';
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b.length > 12 && b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  return null;
}

/**
 * Guarda una imagen validada. El llamador debe haber verificado los permisos.
 * Se rechazan SVG y cualquier archivo que no sea PNG, JPEG o WebP reales.
 */
export async function saveImage(file: File | null, opts: { kind: 'logo' | 'hero' | 'course' | 'avatar' | 'product'; organizationId: string | null; userId: string; isPublic: boolean }) {
  if (!file || file.size === 0) return { error: 'Seleccione una imagen.' };
  if (file.size > MAX) return { error: 'La imagen supera 3 MB.' };
  const buf = Buffer.from(await file.arrayBuffer());
  const mime = sniff(buf);
  if (!mime) return { error: 'Formato no permitido. Use PNG, JPG o WebP.' };
  const { data, error } = await createAdminClient().from('media_assets').insert({
    organization_id: opts.organizationId, kind: opts.kind, mime_type: mime, size_bytes: buf.length,
    sha256: crypto.createHash('sha256').update(buf).digest('hex'), bytes: '\\x' + buf.toString('hex'),
    is_public: opts.isPublic, uploaded_by: opts.userId,
  }).select('id').single();
  if (error) return { error: error.message };
  return { id: data.id as string };
}
