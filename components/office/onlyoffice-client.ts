'use client';
import { putWithProgress } from '@/components/file-uploader';

export const OO_CLIENT_EXT = ['docx', 'odt', 'rtf', 'txt', 'xlsx', 'ods', 'csv', 'pptx', 'odp'];

/** Sube un archivo para editarlo con ONLYOFFICE: en un documento existente (id) o como documento nuevo. */
export async function uploadToOnlyoffice(file: Blob, name: string, target: { id: string } | { org: string; title: string; folder?: string | null }): Promise<string> {
  const ext = (name.split('.').pop() ?? '').toLowerCase();
  const r1 = await fetch('/api/oficina/onlyoffice/subir', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...target, ext, size: file.size }) });
  const j1 = await r1.json().catch(() => ({})); if (!r1.ok) throw new Error(j1.error ?? 'No se pudo preparar la subida');
  await putWithProgress(j1.path, j1.token, file, j1.mime);
  const r2 = await fetch('/api/oficina/onlyoffice/activar', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: j1.id, path: j1.path }) });
  const j2 = await r2.json().catch(() => ({})); if (!r2.ok) throw new Error(j2.error ?? 'No se pudo abrir en ONLYOFFICE');
  return j1.id as string;
}
