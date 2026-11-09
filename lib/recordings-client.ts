'use client';
import { createBrowser } from '@/lib/supabase/browser';

export type RecMeta = { filename: string; duration?: number; group?: string; part?: number; source?: string };

/** Sube una grabación (o una parte) directo al almacenamiento privado y la registra. Devuelve su id. */
export async function uploadRecording(sessionId: string, blob: Blob, meta: RecMeta): Promise<string> {
  const mime = blob.type.startsWith('video/mp4') ? 'video/mp4' : 'video/webm';
  const r1 = await fetch('/api/grabaciones/subir', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ session: sessionId, size: blob.size, mime, source: meta.source }) });
  const j1 = await r1.json().catch(() => ({})); if (!r1.ok) throw new Error(j1.error ?? 'No se pudo autorizar la subida.');
  const up = await createBrowser().storage.from('conference-recordings').uploadToSignedUrl(j1.path, j1.token, blob, { contentType: mime });
  if (up.error) throw new Error(/size|large|exceed/i.test(up.error.message)
    ? 'El video es más grande que lo que permite su plan de almacenamiento (Supabase Free: 50 MB por archivo).' : up.error.message);
  const r2 = await fetch('/api/grabaciones/registrar', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ session: sessionId, path: j1.path, size: blob.size, duration: meta.duration, filename: meta.filename,
      group: meta.group, part: meta.part, source: meta.source }) });
  const j2 = await r2.json().catch(() => ({})); if (!r2.ok) throw new Error(j2.error ?? 'No se pudo registrar la grabación.');
  return j2.id as string;
}
