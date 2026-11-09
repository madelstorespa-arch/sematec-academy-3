/** Tipos de archivo que se pueden subir (sin ejecutables, HTML ni SVG). */
/**
 * Tamaño máximo por archivo. Se ajusta con NEXT_PUBLIC_FILES_MAX_MB en Vercel (por defecto 50 MB, el tope del plan
 * gratis de Supabase). Con Supabase Pro puede subirlo hasta 5000 MB (5 GB) y además subir el límite en
 * Supabase → Storage → Settings → «Upload file size limit».
 */
const MAX_MB = Math.min(5000, Math.max(1, Number(process.env.NEXT_PUBLIC_FILES_MAX_MB) || 50));
export const FILE_MAX = MAX_MB * 1024 * 1024;
export const FILE_MAX_LABEL = MAX_MB >= 1024 ? `${(MAX_MB / 1024).toFixed(MAX_MB % 1024 ? 1 : 0)} GB` : `${MAX_MB} MB`;
export const FILE_TYPES: Record<string, string> = {
  'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif', 'image/heic': 'heic', 'image/heif': 'heif',
  'video/mp4': 'mp4', 'video/webm': 'webm', 'video/quicktime': 'mov', 'video/3gpp': '3gp',
  'audio/mpeg': 'mp3', 'audio/mp4': 'm4a', 'audio/ogg': 'ogg', 'audio/wav': 'wav', 'audio/webm': 'weba', 'audio/x-m4a': 'm4a',
  'application/pdf': 'pdf', 'text/plain': 'txt', 'text/csv': 'csv', 'application/zip': 'zip',
  'application/msword': 'doc', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/vnd.ms-excel': 'xls', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'application/vnd.ms-powerpoint': 'ppt', 'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',
};
export const FILE_ACCEPT = 'image/*,video/*,audio/*,.pdf,.txt,.csv,.zip,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.heic,.mov';
export const fileKind = (mime: string) =>
  mime.startsWith('image/') ? '🖼' : mime.startsWith('video/') ? '🎬' : mime.startsWith('audio/') ? '🎵' : mime === 'application/pdf' ? '📕' : '📄';
export const fmtSize = (n: number) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
