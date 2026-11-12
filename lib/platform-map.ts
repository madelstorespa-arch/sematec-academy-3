/** 🗺 Mapa de la plataforma: cada sistema en su área, con una descripción breve. */
export const MAP_GROUPS: { key: string; title: string; icon: string; color: string; hrefs: string[] }[] = [
  { key: 'mi', title: 'Mi espacio', icon: '👤', color: 'from-slate-700 to-slate-500', hrefs: ['/app', '/app/mi', '/app/apoderado', '/app/credencial', '/app/boletas', '/app/docencia', '/app/perfil'] },
  { key: 'academico', title: 'Gestión académica', icon: '🏛', color: 'from-blue-700 to-indigo-500', hrefs: ['/app/estudiantes', '/app/profesores', '/app/academico', '/app/secciones', '/app/inscripciones', '/app/matriculas', '/app/calificaciones', '/app/asistencia', '/app/certificados', '/app/admision'] },
  { key: 'aula', title: 'Aprendizaje y clases', icon: '🎓', color: 'from-violet-700 to-fuchsia-500', hrefs: ['/app/aula', '/app/conferencias', '/app/biblioteca', '/app/reservas'] },
  { key: 'comunidad', title: 'Comunicación y comunidad', icon: '💬', color: 'from-sky-700 to-cyan-500', hrefs: ['/app/anuncios', '/app/mensajes', '/app/calendario', '/app/encuestas', '/app/punto-estudiantil', '/app/oficinas', '/app/egresados', '/app/empleos', '/app/soporte'] },
  { key: 'productividad', title: 'Oficina y productividad', icon: '💼', color: 'from-emerald-700 to-teal-500', hrefs: ['/app/oficina', '/app/archivos', '/app/traducir'] },
  { key: 'finanzas', title: 'Finanzas y ventas', icon: '💳', color: 'from-amber-600 to-orange-500', hrefs: ['/app/finanzas', '/app/tienda', '/app/sucursales', '/app/inventario'] },
  { key: 'admin', title: 'Administración y personas', icon: '🧾', color: 'from-rose-700 to-pink-500', hrefs: ['/app/personal', '/app/usuarios', '/app/reportes', '/app/configuracion', '/app/sitio', '/app/modulos'] },
  { key: 'sistema', title: 'Seguridad y sistema', icon: '🛡', color: 'from-zinc-800 to-zinc-600', hrefs: ['/app/ciberseguridad', '/app/auditoria', '/app/papelera', '/app/actualizar', '/app/instituciones'] },
];

export const MAP_DESC: Record<string, string> = {
  '/app': 'Resumen del día, accesos rápidos y avisos', '/app/mi': 'Mis cursos, notas, pagos y documentos', '/app/apoderado': 'Notas, asistencia y pagos de sus pupilos',
  '/app/credencial': 'Credencial digital con código QR', '/app/boletas': 'Boletas y comprobantes de pago', '/app/docencia': 'Secciones, asistencia y notas que dicto',
  '/app/perfil': 'Datos, contraseña y verificación en dos pasos', '/app/estudiantes': 'Fichas, documentos y estado de cada estudiante',
  '/app/profesores': 'Docentes, especialidades y carga académica', '/app/academico': 'Carreras, mallas, asignaturas y períodos', '/app/secciones': 'Cursos dictados, horarios y libro de notas',
  '/app/inscripciones': 'Inscripción con curso, jornada, modalidad y pago', '/app/matriculas': 'Matrícula en carreras y cursos, aranceles y cuotas',
  '/app/calificaciones': 'Notas, promedios y actas', '/app/asistencia': 'Asistencia de clases y del personal', '/app/certificados': 'Diplomas y certificados verificables',
  '/app/admision': 'Postulaciones recibidas desde el sitio web', '/app/aula': 'Contenidos, tareas, evaluaciones y foros', '/app/conferencias': 'Clases en vivo tipo Zoom con grabación',
  '/app/biblioteca': 'Libros, recursos digitales y préstamos', '/app/reservas': 'Salas, laboratorios y equipos', '/app/anuncios': 'Avisos para toda la comunidad o un curso',
  '/app/mensajes': 'Mensajes entre personas (también por correo)', '/app/calendario': 'Eventos, feriados y fechas importantes', '/app/encuestas': 'Encuestas y evaluación docente',
  '/app/punto-estudiantil': 'Trámites y solicitudes estudiantiles', '/app/oficinas': 'Oficinas, citas y mesas de ayuda', '/app/egresados': 'Red de egresados',
  '/app/empleos': 'Bolsa de empleo y prácticas', '/app/soporte': 'Ayuda técnica con seguimiento', '/app/oficina': 'Word, Excel, PowerPoint y Publisher en línea',
  '/app/archivos': 'Mis archivos en la nube, carpetas y compartir', '/app/traducir': 'Traductor de textos y documentos', '/app/finanzas': 'Cargos, pagos, caja, gastos y balance',
  '/app/tienda': 'Punto de venta, productos y pedidos', '/app/sucursales': 'Sedes y sucursales', '/app/inventario': 'Bienes, equipos y movimientos',
  '/app/personal': 'Funcionarios, contratos y permisos', '/app/usuarios': 'Cuentas, roles y permisos', '/app/reportes': 'Indicadores y reportes descargables',
  '/app/configuracion': 'Institución, sedes, correo y colores', '/app/sitio': 'Sitio web público, marca y medios de pago', '/app/modulos': 'Mostrar, ocultar y crear módulos del menú',
  '/app/ciberseguridad': 'Estado de seguridad, sesiones e incidentes', '/app/auditoria': 'Registro inalterable de cambios', '/app/papelera': 'Restaurar lo eliminado y ver lo oculto',
  '/app/actualizar': 'Actualizar la base de datos del sistema', '/app/instituciones': 'Plataformas para otras organizaciones',
};
