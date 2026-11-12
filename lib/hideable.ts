/** Registros que se pueden «ocultar para… / por…» (contenido que ven distintos públicos). */
export const HIDEABLE = new Set(['announcements', 'calendar_events', 'library_items', 'job_postings', 'surveys', 'catalog_offerings', 'offices', 'resources',
  'course_contents', 'course_units', 'class_materials', 'forum_threads', 'user_files', 'conference_sessions', 'products', 'media_assets', 'quizzes', 'assignments', 'benefits']);
/** Los que también se ven en el sitio público. */
export const PUBLIC_TABLES = new Set(['catalog_offerings', 'products', 'media_assets']);
export const AUDIENCES: [string, string][] = [['all', 'Todos'], ['public', 'Sitio público'], ['students', 'Estudiantes'], ['teachers', 'Profesores'], ['guardians', 'Apoderados'], ['staff', 'Personal']];
