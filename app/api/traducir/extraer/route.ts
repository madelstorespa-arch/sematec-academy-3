import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';

export const runtime = 'nodejs';
const MAX = 15 * 1024 * 1024;
const LIMIT = 200_000;

/** Extrae el texto de un documento (PDF, Word, texto) para traducirlo en el navegador. No guarda nada. */
export async function POST(req: NextRequest) {
  try {
    const sb = await createClient();
    const { data: { user } } = await sb.auth.getUser();
    if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
    let bytes: Uint8Array, name = '', mime = '';
    const ct = req.headers.get('content-type') ?? '';
    if (ct.startsWith('application/json')) {
      // Un archivo de «Archivos» que la persona puede ver (RLS)
      const { file } = await req.json().catch(() => ({}));
      if (typeof file !== 'string' || !/^[0-9a-f-]{36}$/i.test(file)) return NextResponse.json({ error: 'Archivo inválido' }, { status: 400 });
      const { data: f } = await sb.from('user_files').select('name, mime_type, size_bytes, storage_path').eq('id', file).is('deleted_at', null).maybeSingle();
      if (!f) return NextResponse.json({ error: 'No encontrado o sin permiso' }, { status: 404 });
      if (f.size_bytes > MAX) return NextResponse.json({ error: 'El archivo es demasiado grande para traducir (máx. 15 MB).' }, { status: 413 });
      const dl = await createAdminClient().storage.from('user-files').download(f.storage_path);
      if (dl.error || !dl.data) return NextResponse.json({ error: 'No se pudo leer el archivo.' }, { status: 502 });
      bytes = new Uint8Array(await dl.data.arrayBuffer()); name = f.name; mime = f.mime_type;
    } else {
      const fd = await req.formData();
      const f = fd.get('file');
      if (!(f instanceof File) || !f.size) return NextResponse.json({ error: 'Elija un archivo.' }, { status: 400 });
      if (f.size > MAX) return NextResponse.json({ error: 'El archivo es demasiado grande (máx. 15 MB).' }, { status: 413 });
      bytes = new Uint8Array(await f.arrayBuffer()); name = f.name; mime = f.type;
    }
    const ext = name.toLowerCase().split('.').pop() ?? '';
    let text = '';
    if (mime === 'application/pdf' || ext === 'pdf') {
      const { extractText, getDocumentProxy } = await import('unpdf');
      const pdf = await getDocumentProxy(bytes);
      const r = await extractText(pdf, { mergePages: false });
      text = (r.text as string[]).map((p, i) => `— Página ${i + 1} —\n${p}`).join('\n\n');
    } else if (ext === 'docx' || mime.includes('wordprocessingml')) {
      const mammoth = await import('mammoth');
      text = (await mammoth.extractRawText({ buffer: Buffer.from(bytes) })).value;
    } else if (/^(txt|md|csv|tsv|json|html?|xml|srt|vtt)$/.test(ext) || mime.startsWith('text/')) {
      text = new TextDecoder('utf-8', { fatal: false }).decode(bytes);
      if (/^html?$/.test(ext) || mime === 'text/html') text = text.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ');
    } else {
      return NextResponse.json({ error: 'Formato no soportado para traducir. Use PDF, Word (.docx), texto, CSV o subtítulos (.srt/.vtt).' }, { status: 415 });
    }
    text = text.replace(/\r/g, '').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
    if (!text) return NextResponse.json({ error: 'El documento no tiene texto para traducir (puede ser una imagen escaneada).' }, { status: 422 });
    return NextResponse.json({ name, text: text.slice(0, LIMIT), truncated: text.length > LIMIT });
  } catch (e) {
    console.error('[traducir]', (e as Error).message);
    return NextResponse.json({ error: 'No se pudo leer el documento. Verifique que no esté dañado ni protegido con contraseña.' }, { status: 422 });
  }
}
