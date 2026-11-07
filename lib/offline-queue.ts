/**
 * Bandeja de salida sin conexión (solo en el navegador).
 * Guarda en el dispositivo los formularios enviados sin internet para enviarlos
 * automáticamente cuando vuelve la conexión, siempre con la misma cuenta que los creó.
 */
export type OfflineKey =
  | 'asistencia' | 'notas' | 'mensaje' | 'foro_tema' | 'foro_respuesta'
  | 'soporte' | 'soporte_respuesta' | 'encuesta' | 'egresado' | 'oficina_post';

export type OutboxItem = { id: string; key: OfflineKey; label: string; userId: string; at: string; path: string; fields: [string, string][] };
export type FailedItem = OutboxItem & { error: string };

const OUT = 'sematec-outbox';
const FAILED = 'sematec-outbox-failed';
const USER = 'sematec-user';
export const OUTBOX_EVENT = 'sematec-outbox-change';

function read<T>(k: string): T[] {
  try { return JSON.parse(localStorage.getItem(k) || '[]') as T[]; } catch { return []; }
}
function write(k: string, v: unknown[]) {
  try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* almacenamiento lleno o bloqueado */ }
  window.dispatchEvent(new Event(OUTBOX_EVENT));
}

export const currentUser = () => { try { return localStorage.getItem(USER); } catch { return null; } };
export const setCurrentUser = (id: string) => { try { localStorage.setItem(USER, id); } catch { /* */ } };

export const outbox = () => read<OutboxItem>(OUT);
export const failedItems = () => read<FailedItem>(FAILED);
export const myOutbox = () => { const u = currentUser(); return outbox().filter((i) => i.userId === u); };

/** Guarda el formulario. Devuelve un mensaje para el usuario, o lanza error si no se puede guardar sin conexión. */
export function enqueue(key: OfflineKey, label: string, fd: FormData): string {
  const userId = currentUser();
  if (!userId) throw new Error('Sin sesión en este dispositivo.');
  const fields: [string, string][] = [];
  for (const [k, v] of fd.entries()) {
    if (typeof v !== 'string') {
      if ((v as File).size > 0) throw new Error('Los archivos adjuntos solo se pueden enviar con internet.');
      continue;
    }
    fields.push([k, v]);
  }
  const item: OutboxItem = { id: crypto.randomUUID(), key, label, userId, at: new Date().toISOString(), path: location.pathname, fields };
  write(OUT, [...outbox(), item]);
  return `📴 Sin conexión: «${label}» quedó guardado en este dispositivo y se enviará solo cuando vuelva internet. Aún NO está en la nube.`;
}

export function removeItem(id: string) { write(OUT, outbox().filter((i) => i.id !== id)); }
export function markFailed(item: OutboxItem, error: string) {
  write(FAILED, [...failedItems(), { ...item, error }].slice(-50));
  removeItem(item.id);
}
export function dismissFailed(id: string) { write(FAILED, failedItems().filter((i) => i.id !== id)); }
export function toFormData(item: OutboxItem) {
  const fd = new FormData();
  for (const [k, v] of item.fields) fd.append(k, v);
  return fd;
}
