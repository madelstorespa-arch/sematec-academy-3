/** Solo rutas internas: evita redirecciones abiertas (//sitio, /\sitio, esquemas, espacios). */
export function safeNext(raw: string | null | undefined, fallback = '/app') {
  const v = String(raw ?? '');
  return /^\/(?![/\\])[^\s\\]*$/.test(v) && !v.includes('://') && v.length < 300 ? v : fallback;
}
