/** Nombres legibles de módulos y campos para la Papelera y el Historial de versiones. */
export const TABLE_LABELS: Record<string, string> = {
  programs: 'Carrera', courses: 'Asignatura', sections: 'Sección', campuses: 'Sede', departments: 'Departamento',
  curricula: 'Malla curricular', students: 'Estudiante', teachers: 'Profesor', employees: 'Funcionario',
  catalog_offerings: 'Curso o carrera del catálogo', job_postings: 'Oferta laboral', surveys: 'Encuesta',
  resources: 'Recurso', inventory_items: 'Artículo de inventario', library_items: 'Libro', announcements: 'Anuncio',
  calendar_events: 'Evento', academic_periods: 'Periodo académico', offices: 'Oficina', appointments: 'Cita',
  student_requests: 'Solicitud', guardian_links: 'Vínculo de apoderado', fee_schedules: 'Arancel',
  memberships: 'Rol de usuario', roles: 'Rol', role_permissions: 'Permiso de rol', certificate_templates: 'Plantilla de certificado',
  site_settings: 'Sitio web', organization_settings: 'Configuración', rooms: 'Sala', attendance_records: 'Asistencia',
  assessments: 'Evaluación', assignments: 'Tarea', quizzes: 'Prueba', quiz_questions: 'Pregunta', course_units: 'Unidad',
  course_contents: 'Contenido', class_materials: 'Material de clase', forum_threads: 'Tema del foro', forum_posts: 'Mensaje del foro',
  authorities: 'Autoridad', enrollments: 'Matrícula', section_enrollments: 'Inscripción en sección',
  section_schedules: 'Horario', class_sessions: 'Clase', reservations: 'Reserva', contacts: 'Contacto',
  applications: 'Postulación', benefits: 'Beneficio', leave_requests: 'Solicitud de permiso',
  employment_contracts: 'Contrato', support_tickets: 'Ticket de soporte', conference_rooms: 'Sala virtual',
  conference_sessions: 'Sesión virtual', library_loans: 'Préstamo', document_permissions: 'Permiso de documento',
  grade_scales: 'Escala de notas',
};

const FIELD_LABELS: Record<string, string> = {
  name: 'Nombre', title: 'Título', code: 'Código', status: 'Estado', description: 'Descripción', body: 'Texto',
  first_name: 'Nombres', last_name: 'Apellidos', full_name: 'Nombre completo', email: 'Correo', phone: 'Teléfono',
  level: 'Nivel', duration_terms: 'Duración (periodos)', credits: 'Créditos', price: 'Precio', regular_price: 'Precio normal',
  discount_pct: 'Descuento %', is_published: 'Publicado', published: 'Publicado', starts_at: 'Inicio', ends_at: 'Término',
  starts_on: 'Inicio', ends_on: 'Término', capacity: 'Cupos', topic: 'Tema', details: 'Detalle', subject: 'Asunto',
  role_codes: 'Roles', icon: 'Ícono', address: 'Dirección', notes: 'Notas', amount: 'Monto', role_id: 'Rol',
  requires_mfa: 'Exige MFA', permission_code: 'Permiso', modality: 'Modalidad', currency: 'Moneda',
};
export const fieldLabel = (k: string) => FIELD_LABELS[k] ?? (k.charAt(0).toUpperCase() + k.slice(1)).replace(/_/g, ' ');

export const HIDDEN_FIELDS = new Set(['id', 'organization_id', 'created_at', 'updated_at', 'created_by', 'updated_by']);

export function fmtValue(v: unknown): string {
  if (v === null || v === undefined || v === '') return '—';
  if (v === true) return 'Sí';
  if (v === false) return 'No';
  if (typeof v === 'string') {
    if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(v)) {
      const d = new Date(v);
      if (!isNaN(d.getTime())) return d.toLocaleString('es-CL', { timeZone: 'America/Santiago', dateStyle: 'short', timeStyle: 'short' });
    }
    return v.length > 140 ? v.slice(0, 140) + '…' : v;
  }
  const s = JSON.stringify(v);
  return s.length > 140 ? s.slice(0, 140) + '…' : s;
}

export function recordName(d: Record<string, unknown> | null | undefined): string | null {
  if (!d) return null;
  const n = d.name ?? d.title ?? d.full_name ?? ([d.first_name, d.last_name].filter(Boolean).join(' ') || null) ?? d.subject ?? d.code ?? d.permission_code;
  return n ? String(n) : null;
}
