import 'server-only';
import crypto from 'node:crypto';
import type { Ctx } from '@/lib/context';

const MAX = 4 * 1024 * 1024;
const TYPES: Record<string, { mime: string; magic: (b: Buffer) => boolean }> = {
  pdf: { mime: 'application/pdf', magic: (b) => b.subarray(0, 5).toString() === '%PDF-' },
  docx: { mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', magic: (b) => b[0] === 0x50 && b[1] === 0x4b },
  xlsx: { mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', magic: (b) => b[0] === 0x50 && b[1] === 0x4b },
  pptx: { mime: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', magic: (b) => b[0] === 0x50 && b[1] === 0x4b },
  zip: { mime: 'application/zip', magic: (b) => b[0] === 0x50 && b[1] === 0x4b },
  doc: { mime: 'application/msword', magic: (b) => b.readUInt32BE(0) === 0xd0cf11e0 },
  xls: { mime: 'application/vnd.ms-excel', magic: (b) => b.readUInt32BE(0) === 0xd0cf11e0 },
  ppt: { mime: 'application/vnd.ms-powerpoint', magic: (b) => b.readUInt32BE(0) === 0xd0cf11e0 },
  png: { mime: 'image/png', magic: (b) => b.readUInt32BE(0) === 0x89504e47 },
  jpg: { mime: 'image/jpeg', magic: (b) => b[0] === 0xff && b[1] === 0xd8 },
  jpeg: { mime: 'image/jpeg', magic: (b) => b[0] === 0xff && b[1] === 0xd8 },
  txt: { mime: 'text/plain; charset=utf-8', magic: (b) => !b.includes(0) },
  sql: { mime: 'text/plain; charset=utf-8', magic: (b) => !b.includes(0) },
};
export const ACCEPT = Object.keys(TYPES).map((e) => '.' + e).join(',');

/** Guarda un archivo del aula verificando tamaño, extensión y contenido real. Devuelve el id o null si no se envió archivo. */
export async function saveLmsFile(ctx: Ctx, file: File | null, sectionId: string, purpose: 'content' | 'submission'): Promise<string | null> {
  if (!file || file.size === 0) return null;
  if (file.size > MAX) throw new Error('El archivo supera 4 MB.');
  const ext = (file.name.split('.').pop() ?? '').toLowerCase();
  const t = TYPES[ext];
  const buf = Buffer.from(await file.arrayBuffer());
  if (!t || buf.length < 4 || !t.magic(buf)) throw new Error('Tipo de archivo no permitido. Use PDF, Word, Excel, PowerPoint, ZIP, imagen o texto.');
  const name = file.name.replace(/[^\w.\- áéíóúñÁÉÍÓÚÑ()]/g, '_').slice(0, 200);
  const { data, error } = await ctx.supabase.from('lms_files').insert({
    organization_id: ctx.orgId, section_id: sectionId, purpose, filename: name, mime_type: t.mime, size_bytes: buf.length,
    sha256: crypto.createHash('sha256').update(buf).digest('hex'), bytes: '\\x' + buf.toString('hex'),
  }).select('id').single();
  if (error) throw new Error(error.message);
  return data.id as string;
}

/** «2026-11-10T18:00» (hora de Chile) → ISO UTC */
export function localToIso(v: string, tz = 'America/Santiago'): string {
  const d = new Date(v + ':00Z');
  if (Number.isNaN(d.getTime())) throw new Error('Fecha inválida');
  const inTz = new Date(d.toLocaleString('en-US', { timeZone: tz }));
  const inUtc = new Date(d.toLocaleString('en-US', { timeZone: 'UTC' }));
  return new Date(d.getTime() + (inUtc.getTime() - inTz.getTime())).toISOString();
}
