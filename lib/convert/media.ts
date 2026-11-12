'use client';
/**
 * 🎬 Conversión de videos, audios e imágenes dentro del navegador (FFmpeg WebAssembly y canvas).
 * Nada se sube a servidores externos: el archivo se convierte en el equipo de la persona.
 */
import type { FFmpeg } from '@ffmpeg/ffmpeg';

export type Fmt = { id: string; label: string; ext: string; mime: string; hint?: string };

export const VIDEO_FORMATS: Fmt[] = [
  { id: 'mp4', label: 'MP4 (H.264)', ext: 'mp4', mime: 'video/mp4', hint: 'El más compatible: celulares, TV, WhatsApp, YouTube' },
  { id: 'webm', label: 'WebM', ext: 'webm', mime: 'video/webm', hint: 'Navegadores web' },
  { id: 'mkv', label: 'MKV', ext: 'mkv', mime: 'video/x-matroska', hint: 'Reproductores como VLC' },
  { id: 'mov', label: 'MOV (QuickTime)', ext: 'mov', mime: 'video/quicktime', hint: 'Mac, iPhone, Final Cut' },
  { id: 'avi', label: 'AVI', ext: 'avi', mime: 'video/x-msvideo', hint: 'Equipos y programas antiguos' },
  { id: 'gif', label: 'GIF animado (15 s)', ext: 'gif', mime: 'image/gif', hint: 'Los primeros 15 segundos, sin sonido' },
  { id: 'mp3', label: 'MP3 (solo audio)', ext: 'mp3', mime: 'audio/mpeg', hint: 'Escuchar la clase como podcast' },
  { id: 'm4a', label: 'M4A (solo audio)', ext: 'm4a', mime: 'audio/mp4' },
  { id: 'wav', label: 'WAV (solo audio)', ext: 'wav', mime: 'audio/wav', hint: 'Sin compresión, para editar' },
  { id: 'ogg', label: 'OGG (solo audio)', ext: 'ogg', mime: 'audio/ogg' },
];
export const AUDIO_FORMATS: Fmt[] = VIDEO_FORMATS.filter((f) => ['mp3', 'm4a', 'wav', 'ogg'].includes(f.id))
  .concat([{ id: 'flac', label: 'FLAC (sin pérdida)', ext: 'flac', mime: 'audio/flac' }]);
export const IMAGE_FORMATS: Fmt[] = [
  { id: 'png', label: 'PNG', ext: 'png', mime: 'image/png' },
  { id: 'jpg', label: 'JPG', ext: 'jpg', mime: 'image/jpeg' },
  { id: 'webp', label: 'WEBP', ext: 'webp', mime: 'image/webp' },
  { id: 'pdf', label: 'PDF', ext: 'pdf', mime: 'application/pdf' },
];

let ffPromise: Promise<FFmpeg> | null = null;
export function loadFFmpeg() {
  if (!ffPromise) {
    ffPromise = (async () => {
      const { FFmpeg } = await import('@ffmpeg/ffmpeg');
      const f = new FFmpeg();
      await f.load({ classWorkerURL: `${location.origin}/ffmpeg/worker/worker.js`, coreURL: `${location.origin}/ffmpeg/esm/ffmpeg-core.js`, wasmURL: `${location.origin}/ffmpeg/esm/ffmpeg-core.wasm` });
      return f;
    })().catch((e) => { ffPromise = null; throw e; });
  }
  return ffPromise;
}

const extOf = (name: string, mime: string) => (name.match(/\.([a-z0-9]{2,5})$/i)?.[1] ?? mime.split('/')[1]?.split(';')[0] ?? 'bin').toLowerCase();

function argsFor(target: string, srcExt: string): string[] {
  const x264 = ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-pix_fmt', 'yuv420p'];
  const aac = ['-c:a', 'aac', '-b:a', '128k'];
  switch (target) {
    case 'mp4': return srcExt === 'mp4' ? ['-c', 'copy', '-movflags', '+faststart'] : [...x264, ...aac, '-movflags', '+faststart'];
    case 'mov': return srcExt === 'mp4' || srcExt === 'mov' ? ['-c', 'copy'] : [...x264, ...aac];
    case 'webm': return ['-c:v', 'libvpx', '-deadline', 'realtime', '-cpu-used', '8', '-b:v', '1M', '-c:a', 'libopus', '-b:a', '96k'];
    case 'mkv': return ['-c', 'copy'];
    case 'avi': return ['-c:v', 'mpeg4', '-q:v', '5', '-c:a', 'libmp3lame', '-q:a', '4'];
    case 'gif': return ['-t', '15', '-vf', 'fps=10,scale=480:-1:flags=lanczos', '-an', '-loop', '0'];
    case 'mp3': return ['-vn', '-c:a', 'libmp3lame', '-q:a', '2'];
    case 'm4a': return ['-vn', '-c:a', 'aac', '-b:a', '160k'];
    case 'wav': return ['-vn', '-c:a', 'pcm_s16le'];
    case 'ogg': return ['-vn', '-c:a', 'libvorbis', '-q:a', '5'];
    case 'flac': return ['-vn', '-c:a', 'flac'];
    default: throw new Error('Formato no disponible');
  }
}

/** Convierte un video o audio. onProgress recibe 0..1. */
export async function convertMedia(src: Blob, name: string, target: string, onProgress?: (p: number, msg: string) => void): Promise<Blob> {
  const fmt = [...VIDEO_FORMATS, ...AUDIO_FORMATS].find((f) => f.id === target);
  if (!fmt) throw new Error('Formato no disponible');
  if (src.size > 1.8 * 1024 ** 3) throw new Error('El archivo es demasiado grande para convertirlo en el navegador (máx. ~1,8 GB). Descargue el original.');
  onProgress?.(0, 'Preparando el convertidor (solo la primera vez, ~30 MB)…');
  const f = await loadFFmpeg();
  const sx = extOf(name, src.type);
  const input = `entrada.${sx}`; const output = `salida.${fmt.ext}`;
  const prog = ({ progress }: { progress: number }) => onProgress?.(Math.max(0, Math.min(1, progress)), 'Convirtiendo…');
  f.on('progress', prog);
  try {
    await f.writeFile(input, new Uint8Array(await src.arrayBuffer()));
    onProgress?.(0.01, 'Convirtiendo…');
    let code = await f.exec(['-i', input, ...argsFor(target, sx), '-y', output]);
    // Si copiar sin recodificar no es posible (códec incompatible con el contenedor), se recodifica
    if (code !== 0 && ['mkv', 'mov', 'mp4'].includes(target)) code = await f.exec(['-i', input, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-y', output]);
    if (code !== 0) throw new Error('No se pudo convertir este archivo a ese formato.');
    const data = await f.readFile(output);
    onProgress?.(1, 'Listo');
    return new Blob([new Uint8Array(data as Uint8Array)], { type: fmt.mime });
  } finally {
    f.off('progress', prog);
    await f.deleteFile(input).catch(() => {}); await f.deleteFile(output).catch(() => {});
  }
}

/** Convierte una imagen a PNG, JPG, WEBP o PDF. */
export async function convertImage(src: Blob, target: string): Promise<Blob> {
  const bmp = await createImageBitmap(src);
  const c = document.createElement('canvas'); c.width = bmp.width; c.height = bmp.height;
  const g = c.getContext('2d')!;
  if (target === 'jpg' || target === 'pdf') { g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); }
  g.drawImage(bmp, 0, 0);
  const toBlob = (type: string, q?: number) => new Promise<Blob>((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('No se pudo convertir la imagen'))), type, q));
  if (target === 'png') return toBlob('image/png');
  if (target === 'jpg') return toBlob('image/jpeg', 0.92);
  if (target === 'webp') return toBlob('image/webp', 0.92);
  if (target === 'pdf') {
    const { PDFDocument } = await import('pdf-lib');
    const pdf = await PDFDocument.create();
    const jpg = await pdf.embedJpg(new Uint8Array(await (await toBlob('image/jpeg', 0.92)).arrayBuffer()));
    const page = pdf.addPage([jpg.width, jpg.height]);
    page.drawImage(jpg, { x: 0, y: 0, width: jpg.width, height: jpg.height });
    return new Blob([await pdf.save() as BlobPart], { type: 'application/pdf' });
  }
  throw new Error('Formato no disponible');
}

export function saveBlob(blob: Blob, filename: string) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = filename.replace(/[\\/:*?"<>|]/g, '-');
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 60_000);
}

export const baseName = (name: string) => name.replace(/\.[a-z0-9]{2,5}$/i, '');
