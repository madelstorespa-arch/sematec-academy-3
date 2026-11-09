/**
 * Editor universal del propietario: qué campos se muestran de cada entidad y dónde
 * volver. Los tipos, opciones y listas relacionadas se leen de la base (entity_schema),
 * y la base vuelve a validar todo (owner_update): aquí solo se decide el orden visible.
 */
export type EntitySpec = { fields?: string[]; back: string };

export const ENTITIES: Record<string, EntitySpec> = {
  programs: { back: '/app/academico', fields: ['code', 'name', 'level', 'modality', 'duration_terms', 'department_id', 'grade_scale_id', 'status'] },
  courses: { back: '/app/academico?t=cursos', fields: ['code', 'name', 'credits', 'weekly_hours', 'description', 'status'] },
  academic_periods: { back: '/app/academico?t=periodos', fields: ['code', 'name', 'starts_on', 'ends_on', 'enrollment_opens_on', 'enrollment_closes_on', 'status'] },
  curricula: { back: '/app/academico', fields: ['version', 'valid_from', 'total_credits', 'min_attendance_pct', 'status'] },
  grade_scales: { back: '/app/academico', fields: ['name', 'min_grade', 'max_grade', 'passing_grade', 'decimals'] },
  sections: { back: '/app/secciones', fields: ['code', 'course_id', 'period_id', 'campus_id', 'teacher_id', 'capacity', 'min_attendance_pct', 'modality', 'grade_scale_id', 'status'] },
  section_schedules: { back: '/app/secciones', fields: ['weekday', 'room_id', 'teacher_id'] },
  class_sessions: { back: '/app/secciones', fields: ['starts_at', 'ends_at', 'topic', 'content_covered', 'teacher_id', 'teacher_status'] },
  assessments: { back: '/app/secciones', fields: ['name', 'weight_pct', 'due_on', 'published'] },
  attendance_records: { back: '/app/asistencia', fields: ['status', 'notes'] },
  campuses: { back: '/app/configuracion', fields: ['code', 'name', 'city', 'address', 'country_code', 'timezone', 'status'] },
  rooms: { back: '/app/configuracion', fields: ['code', 'name', 'capacity', 'room_type', 'campus_id', 'status'] },
  departments: { back: '/app/configuracion', fields: ['code', 'name', 'campus_id', 'parent_id', 'status'] },
  students: { back: '/app/estudiantes', fields: ['student_code', 'first_names', 'last_names', 'email', 'phone', 'birth_date', 'nationality', 'campus_id', 'admitted_on', 'status'] },
  teachers: { back: '/app/profesores', fields: ['teacher_code', 'first_names', 'last_names', 'email', 'academic_degree', 'specialty', 'campus_id', 'status'] },
  employees: { back: '/app/personal', fields: ['employee_code', 'first_names', 'last_names', 'email', 'position', 'department_id', 'campus_id', 'status'] },
  employment_contracts: { back: '/app/personal', fields: ['contract_type', 'starts_on', 'ends_on', 'salary_amount', 'currency', 'status'] },
  leave_requests: { back: '/app/personal', fields: ['kind', 'starts_on', 'ends_on', 'reason', 'status'] },
  staff_attendance: { back: '/app/asistencia?t=personal', fields: ['work_date', 'check_in', 'check_out', 'notes'] },
  authorities: { back: '/app/configuracion', fields: ['position', 'full_name', 'email', 'starts_on', 'ends_on', 'campus_id'] },
  catalog_offerings: { back: '/app/sitio/cursos', fields: ['kind', 'title', 'summary', 'description', 'category', 'modality', 'duration_text', 'schedule_text', 'starts_on', 'regular_price', 'discount_pct', 'discount_ends_on', 'price', 'currency', 'capacity', 'admission_mode', 'program_id', 'period_id', 'sort_order', 'is_published'] },
  job_postings: { back: '/app/empleos', fields: ['kind', 'title', 'company', 'location', 'modality', 'description', 'apply_url', 'apply_email', 'closes_on', 'published'] },
  surveys: { back: '/app/encuestas', fields: ['title', 'description', 'audience', 'section_id', 'anonymous', 'opens_at', 'closes_at', 'published'] },
  resources: { back: '/app/reservas', fields: ['code', 'name', 'kind', 'campus_id', 'status', 'notes'] },
  reservations: { back: '/app/reservas', fields: ['purpose', 'reserved_name', 'status'] },
  inventory_items: { back: '/app/inventario', fields: ['code', 'name', 'category', 'brand', 'model', 'serial_number', 'status', 'assigned_to', 'purchase_date', 'purchase_value', 'currency', 'campus_id', 'room_id', 'notes'] },
  library_items: { back: '/app/biblioteca', fields: ['item_type', 'title', 'author', 'publisher', 'year', 'isbn', 'category', 'program_id', 'course_id', 'section_id', 'url', 'description', 'total_copies'] },
  announcements: { back: '/app/anuncios', fields: ['title', 'body', 'audience', 'section_id', 'pinned', 'published_at', 'expires_at'] },
  calendar_events: { back: '/app/calendario', fields: ['title', 'kind', 'description', 'starts_at', 'ends_at', 'all_day', 'audience', 'campus_id'] },
  offices: { back: '/app/oficinas', fields: ['name', 'description', 'icon', 'attention_hours', 'accepts_appointments', 'role_codes'] },
  appointments: { back: '/app/oficinas', fields: ['topic', 'details', 'mode', 'starts_at', 'duration_min', 'status', 'staff_note'] },
  student_requests: { back: '/app/punto-estudiantil', fields: [] },
  fee_schedules: { back: '/app/finanzas', fields: ['concept', 'amount', 'currency', 'default_installments', 'program_id', 'period_id'] },
  benefits: { back: '/app/finanzas', fields: ['code', 'name', 'percent_off', 'amount_off', 'status'] },
  certificate_templates: { back: '/app/certificados', fields: ['code', 'name', 'certificate_type', 'title_template', 'subtitle', 'body_template', 'footer_text', 'city', 'signer1_name', 'signer1_title', 'signer2_name', 'signer2_title', 'status'] },
  conference_rooms: { back: '/app/conferencias', fields: ['name', 'room_type', 'max_participants', 'section_id', 'campus_id', 'status'] },
  conference_sessions: { back: '/app/conferencias', fields: ['title', 'session_type', 'scheduled_start', 'scheduled_end', 'recording_enabled', 'students_can_share', 'chat_enabled', 'waiting_message', 'min_attendance_pct', 'status'] },
  course_units: { back: '/app/aula', fields: ['title', 'description', 'position', 'published'] },
  course_contents: { back: '/app/aula', fields: ['title', 'kind', 'body', 'url', 'unit_id', 'position', 'published'] },
  assignments: { back: '/app/aula', fields: ['title', 'instructions', 'due_at', 'max_score', 'allow_late', 'assessment_id', 'published'] },
  quizzes: { back: '/app/aula', fields: ['title', 'instructions', 'opens_at', 'closes_at', 'time_limit_min', 'max_attempts', 'show_results', 'assessment_id', 'published'] },
  class_materials: { back: '/app/aula', fields: ['title', 'external_url', 'published'] },
  forum_threads: { back: '/app/aula', fields: ['title', 'body', 'pinned', 'locked'] },
  support_tickets: { back: '/app/soporte', fields: ['subject', 'category', 'priority', 'status'] },
  guardian_links: { back: '/app/apoderado', fields: [] },
};

/** Campos que se escriben en un cuadro de texto grande. */
export const LONG_TEXT = new Set(['description', 'body', 'details', 'instructions', 'notes', 'summary', 'reason', 'content_covered',
  'staff_note', 'body_template', 'footer_text', 'waiting_message']);

/** Etiquetas de campos que no están en el diccionario general. */
export const EXTRA_FIELD_LABELS: Record<string, string> = {
  department_id: 'Departamento', grade_scale_id: 'Escala de notas', course_id: 'Asignatura', period_id: 'Periodo', campus_id: 'Sede',
  teacher_id: 'Profesor', room_id: 'Sala', section_id: 'Sección', program_id: 'Carrera', unit_id: 'Unidad', assessment_id: 'Evaluación del libro de notas',
  parent_id: 'Depende de', weekday: 'Día (1 = lunes … 7 = domingo)', min_attendance_pct: 'Asistencia mínima %', weekly_hours: 'Horas semanales',
  enrollment_opens_on: 'Abre matrícula', enrollment_closes_on: 'Cierra matrícula', valid_from: 'Vigente desde', total_credits: 'Créditos totales',
  min_grade: 'Nota mínima', max_grade: 'Nota máxima', passing_grade: 'Nota de aprobación', decimals: 'Decimales', version: 'Versión',
  student_code: 'Código', teacher_code: 'Código', employee_code: 'Código', birth_date: 'Fecha de nacimiento', nationality: 'Nacionalidad (código país)',
  admitted_on: 'Fecha de ingreso', academic_degree: 'Grado académico', specialty: 'Especialidad', position: 'Cargo', contract_type: 'Tipo de contrato',
  salary_amount: 'Remuneración', kind: 'Tipo', work_date: 'Fecha', check_in: 'Entrada', check_out: 'Salida', full_name: 'Nombre completo',
  city: 'Ciudad', country_code: 'País (código)', timezone: 'Zona horaria', room_type: 'Tipo de sala', summary: 'Resumen', category: 'Categoría',
  duration_text: 'Duración (texto)', schedule_text: 'Horario (texto)', admission_mode: 'Forma de ingreso', sort_order: 'Orden', is_published: 'Publicado',
  company: 'Empresa', location: 'Lugar', apply_url: 'Enlace para postular', apply_email: 'Correo para postular', closes_on: 'Cierra el',
  audience: 'Dirigido a', anonymous: 'Anónima', opens_at: 'Abre', closes_at: 'Cierra', reserved_name: 'Reservado por', purpose: 'Motivo',
  brand: 'Marca', model: 'Modelo', serial_number: 'N° de serie', assigned_to: 'Asignado a', purchase_date: 'Fecha de compra', purchase_value: 'Valor de compra',
  item_type: 'Tipo', author: 'Autor', publisher: 'Editorial', year: 'Año', isbn: 'ISBN', url: 'Enlace', total_copies: 'Ejemplares',
  pinned: 'Destacado', published_at: 'Publicado desde', expires_at: 'Vence', all_day: 'Todo el día', attention_hours: 'Horario de atención',
  accepts_appointments: 'Acepta citas', mode: 'Modalidad', duration_min: 'Duración (min)', concept: 'Concepto', default_installments: 'Cuotas por defecto',
  percent_off: 'Descuento %', amount_off: 'Descuento en monto', certificate_type: 'Tipo de certificado', title_template: 'Título', subtitle: 'Subtítulo',
  body_template: 'Texto del certificado', footer_text: 'Pie de página', signer1_name: 'Firma 1: nombre', signer1_title: 'Firma 1: cargo',
  signer2_name: 'Firma 2: nombre', signer2_title: 'Firma 2: cargo', max_participants: 'Máximo de participantes', session_type: 'Tipo de sesión',
  scheduled_start: 'Inicio', scheduled_end: 'Término', recording_enabled: 'Permite grabar', students_can_share: 'Estudiantes pueden compartir pantalla',
  chat_enabled: 'Chat activado', waiting_message: 'Mensaje de espera', position_num: 'Orden', due_at: 'Entrega', max_score: 'Puntaje máximo',
  allow_late: 'Acepta atrasos', time_limit_min: 'Tiempo límite (min)', max_attempts: 'Intentos', show_results: 'Muestra resultados',
  external_url: 'Enlace', locked: 'Cerrado', priority: 'Prioridad', weight_pct: 'Ponderación %', due_on: 'Fecha', topic: 'Tema',
  content_covered: 'Contenido visto', teacher_status: 'Estado de la clase', starts_at: 'Inicio', ends_at: 'Término', role_codes: 'Roles que la atienden',
  icon: 'Ícono', regular_price: 'Precio normal', discount_ends_on: 'Descuento hasta', price: 'Precio (si no usa precio normal)', capacity: 'Cupos',
};

/** Entidades que se pueden suspender / activar (igual que private.owner_tables en la base). */
export const SUSPENDABLE: Record<string, (row: Record<string, unknown>) => boolean> = {
  programs: (r) => r.status === 'active', courses: (r) => r.status === 'active', sections: (r) => r.status === 'active',
  campuses: (r) => r.status === 'active', departments: (r) => r.status === 'active', curricula: (r) => r.status === 'active',
  students: (r) => r.status === 'active', teachers: (r) => r.status === 'active', employees: (r) => r.status === 'active',
  catalog_offerings: (r) => !!r.is_published, job_postings: (r) => !!r.published, surveys: (r) => !!r.published,
  resources: (r) => r.status !== 'mantencion', inventory_items: (r) => r.status !== 'de_baja', rooms: (r) => r.status === 'active',
  conference_rooms: (r) => r.status === 'active', benefits: (r) => r.status === 'active', certificate_templates: (r) => r.status === 'active',
  employment_contracts: (r) => r.status === 'active', assessments: (r) => !!r.published, course_units: (r) => !!r.published,
  course_contents: (r) => !!r.published, assignments: (r) => !!r.published, quizzes: (r) => !!r.published, class_materials: (r) => !!r.published,
};
