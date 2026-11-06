import 'server-only';

export type ActionResult = { ok: boolean; message?: string; error?: string; data?: unknown };

type PgError = { code?: string; message?: string; details?: string | null; hint?: string | null } | null | undefined;

/** Traduce errores de PostgreSQL/PostgREST a mensajes claros para el usuario. */
export function explain(err: PgError): string {
  if (!err) return 'Error desconocido';
  const msg = err.message ?? '';
  switch (err.code) {
    case '42501':
      return msg.startsWith('permission denied') || msg.includes('row-level security')
        ? 'No tiene permisos para realizar esta operación.'
        : msg;
    case '23505':
      return msg.match(/[A-ZÁÉÍÓÚ]/) && !msg.startsWith('duplicate key') ? msg : 'Ya existe un registro con esos datos (código, documento o correo repetido).';
    case '23503':
      return msg.startsWith('insert or update') ? 'Referencia inválida: el registro relacionado no existe o pertenece a otra institución.' : msg;
    case '23514':
      return msg.startsWith('new row') ? 'Datos inválidos: revise formatos y valores permitidos.' : msg;
    case '23P01':
      return msg.startsWith('conflicting key') ? 'Conflicto de horario: la sala o el profesor ya están ocupados en ese bloque.' : msg;
    case '22P02':
      return 'Formato de dato inválido.';
    case 'PGRST116':
      return 'Registro no encontrado.';
    default:
      return msg || 'No se pudo completar la operación.';
  }
}

export function fail(err: PgError | string): ActionResult {
  return { ok: false, error: typeof err === 'string' ? err : explain(err) };
}

export function ok(message: string, data?: unknown): ActionResult {
  return { ok: true, message, data };
}

/** Lee un campo de texto del formulario (vacío -> null). */
export function str(fd: FormData, key: string): string | null {
  const v = fd.get(key);
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t === '' ? null : t;
}

export function num(fd: FormData, key: string): number | null {
  const v = str(fd, key);
  if (v === null) return null;
  const n = Number(v.replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

export function reqStr(fd: FormData, key: string, label: string): string {
  const v = str(fd, key);
  if (!v) throw new ValidationError(`El campo «${label}» es obligatorio.`);
  return v;
}

export class ValidationError extends Error {}

/** Ejecuta una acción capturando errores de validación. */
export async function guard(fn: () => Promise<ActionResult>): Promise<ActionResult> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof ValidationError) return { ok: false, error: e.message };
    if (e && typeof e === 'object' && 'digest' in e) throw e; // redirect/notFound de Next.js
    console.error(e);
    return { ok: false, error: 'Error inesperado del servidor. La operación no se completó.' };
  }
}
