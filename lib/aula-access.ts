import 'server-only';

export type AccessRow = {
  student_id: string; full_name: string; email: string | null; student_code: string | null; account_email: string | null;
  issue: Issue; matriculas: number; secciones: number; programa: string | null;
};
export type Issue = 'ok' | 'cuenta_sin_vincular' | 'sin_cuenta' | 'cuenta_suspendida' | 'sin_acceso' | 'sin_matricula' | 'sin_cursos';

export const ISSUE: Record<Issue, { label: string; why: string; color: 'green' | 'amber' | 'red' | 'blue' | 'gray' }> = {
  ok: { label: 'Ve sus cursos', why: 'Todo en orden.', color: 'green' },
  cuenta_sin_vincular: { label: 'Cuenta sin vincular', why: 'Tiene cuenta con el mismo correo, pero no está unida a su ficha. Se repara con un clic.', color: 'amber' },
  sin_cuenta: { label: 'Sin cuenta', why: 'No tiene usuario para entrar. Use «Crear contraseña» en su ficha.', color: 'red' },
  cuenta_suspendida: { label: 'Cuenta suspendida', why: 'Su cuenta está bloqueada o suspendida: reactívela en Usuarios.', color: 'red' },
  sin_acceso: { label: 'Sin acceso a la institución', why: 'Su cuenta no tiene el rol de estudiante en esta institución. Se repara con un clic.', color: 'amber' },
  sin_matricula: { label: 'Sin matrícula', why: 'No está matriculado en una carrera o programa en un periodo.', color: 'amber' },
  sin_cursos: { label: 'Sin cursos', why: 'Está matriculado, pero no inscrito en ninguna sección (asignatura). Se repara con un clic si hay secciones abiertas.', color: 'amber' },
};

export type FixResult = { linked: number; access: number; sections: number; not_placed: number; no_matricula: number; no_offer: number };

/** Resumen en palabras del resultado de la reparación. */
export function fixSummary(r: FixResult, one = false): string {
  const parts: string[] = [];
  if (r.linked) parts.push(`${r.linked} cuenta(s) vinculada(s) a su ficha`);
  if (r.access) parts.push(`${r.access} acceso(s) de estudiante activado(s)`);
  if (r.sections) parts.push(`${r.sections} inscripción(es) en asignaturas`);
  const warn: string[] = [];
  if (r.not_placed) warn.push(`${r.not_placed} asignatura(s) sin cupo, con prerrequisito pendiente o choque de horario`);
  if (r.no_offer) warn.push(`${r.no_offer} matrícula(s) sin secciones abiertas de su malla en el periodo (cree las secciones en «Secciones y notas»)`);
  if (one && r.no_matricula) warn.push('no tiene matrícula: matricúlelo primero');
  return (parts.length ? `${parts.join(', ')}.` : 'No había nada que reparar automáticamente.') + (warn.length ? ` ⚠ ${warn.join('; ')}.` : '');
}
