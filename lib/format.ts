export const fmtDate = (d?: string | null, tz = 'America/Santiago') =>
  d ? new Intl.DateTimeFormat('es-CL', { dateStyle: 'medium', timeZone: tz }).format(new Date(d.length === 10 ? d + 'T12:00:00Z' : d)) : '—';

export const fmtDateTime = (d?: string | null, tz = 'America/Santiago') =>
  d ? new Intl.DateTimeFormat('es-CL', { dateStyle: 'medium', timeStyle: 'short', timeZone: tz }).format(new Date(d)) : '—';

export const fmtMoney = (n: number | string | null | undefined, currency = 'CLP') =>
  n === null || n === undefined ? '—' : new Intl.NumberFormat('es-CL', { style: 'currency', currency }).format(Number(n));

export const fmtNum = (n: number | string | null | undefined, d = 1) =>
  n === null || n === undefined ? '—' : Number(n).toLocaleString('es-CL', { minimumFractionDigits: d, maximumFractionDigits: d });

export const fullName = (p?: { first_names?: string | null; last_names?: string | null } | null) =>
  p ? `${p.first_names ?? ''} ${p.last_names ?? ''}`.trim() : '—';

export const WEEKDAYS = ['', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];

export const LABELS: Record<string, string> = {
  active: 'Activo', inactive: 'Inactivo', archived: 'Archivado', graduated: 'Egresado', withdrawn: 'Retirado',
  suspended: 'Suspendido', completed: 'Completado', cancelled: 'Anulado', enrolled: 'Inscrito', dropped: 'Dado de baja',
  in_progress: 'En curso', approved: 'Aprobado', failed: 'Reprobado', pending: 'Pendiente', partially_paid: 'Pago parcial',
  paid: 'Pagado', confirmed: 'Confirmado', voided: 'Anulado', issued: 'Vigente', revoked: 'Revocado',
  scheduled: 'Programada', live: 'En vivo', ended: 'Finalizada', present: 'Presente', absent: 'Ausente', late: 'Atraso',
  excused: 'Justificado', planned: 'Planificado', open: 'Abierto', closed: 'Cerrado', draft: 'Borrador',
  submitted: 'Enviada', under_review: 'En revisión', rejected: 'Rechazada', locked: 'Bloqueada',
  class: 'Clase', meeting: 'Reunión', webinar: 'Webinar', congress: 'Congreso', tutoring: 'Tutoría', revoked_m: 'Revocada',
};
export const label = (s?: string | null) => (s ? LABELS[s] ?? s : '—');

/** Desfase UTC de una zona horaria, p. ej. "-03:00". */
export function tzOffset(tz: string, date = new Date()): string {
  const v = new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'longOffset' }).formatToParts(date).find((p) => p.type === 'timeZoneName')?.value ?? 'GMT';
  return v === 'GMT' ? '+00:00' : v.replace('GMT', '');
}

export const PAY_METHODS = [['cash', 'Efectivo'], ['bank_transfer', 'Transferencia'], ['card', 'Tarjeta'], ['payment_gateway', 'Pasarela en línea'], ['check', 'Cheque'], ['other', 'Otro']]
  .map(([value, label]) => ({ value, label }));

/** Rango horario de PostgreSQL ("[08:30:00,10:00:00)") a "08:30–10:00". */
export function fmtSlot(slot: unknown): string {
  const m = String(slot).match(/(\d{2}:\d{2})(?::\d{2})?\s*,\s*"?(\d{2}:\d{2})/);
  return m ? `${m[1]}–${m[2]}` : String(slot);
}

export const CONF_ROLES: Record<string, string> = {
  organizer: 'Organizador', presenter: 'Presentador', moderator: 'Moderador', teacher: 'Profesor', student: 'Estudiante', attendee: 'Asistente', guest: 'Invitado',
};
