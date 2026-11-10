/**
 * 🌐 Idioma por usuario. El menú y los botones fijos se traducen con este diccionario; el resto de la página
 * (textos, documentos, chat y subtítulos) lo traduce el navegador de cada persona (Chrome / Edge) sin costo.
 * El idioma de una persona no cambia nada para las demás.
 */
export const LOCALES: [string, string, string][] = [
  ['es', 'Español', '🇨🇱'], ['en', 'English', '🇺🇸'], ['pt', 'Português', '🇧🇷'], ['fr', 'Français', '🇫🇷'], ['de', 'Deutsch', '🇩🇪'],
  ['it', 'Italiano', '🇮🇹'], ['zh', '中文', '🇨🇳'], ['ja', '日本語', '🇯🇵'], ['ko', '한국어', '🇰🇷'], ['ar', 'العربية', '🇸🇦'],
  ['ru', 'Русский', '🇷🇺'], ['hi', 'हिन्दी', '🇮🇳'], ['tr', 'Türkçe', '🇹🇷'], ['nl', 'Nederlands', '🇳🇱'], ['pl', 'Polski', '🇵🇱'], ['uk', 'Українська', '🇺🇦'],
];
export const isLocale = (l: unknown): l is string => typeof l === 'string' && LOCALES.some(([c]) => c === l);
export const RTL = new Set(['ar']);

type Dict = Record<string, string>;
const NAV: Record<string, Dict> = {
  en: {
    'Inicio': 'Home', 'Mi portal': 'My portal', 'Mis pupilos': 'My children', 'Mi credencial': 'My ID card', 'Mis boletas': 'My receipts', 'Mis secciones': 'My sections',
    'Estudiantes': 'Students', 'Profesores': 'Teachers', 'Carreras y asignaturas': 'Programs and courses', 'Secciones y notas': 'Sections and grades', 'Matrículas': 'Enrollments',
    'Finanzas': 'Finance', 'SEMATEC VENTA': 'SEMATEC STORE', 'Sucursales': 'Branches', 'Certificados': 'Certificates', 'Aula de aprendizaje': 'Learning classroom',
    'Aulas virtuales': 'Virtual classrooms', 'Anuncios': 'Announcements', 'Mensajes': 'Messages', 'Biblioteca': 'Library', 'Soporte técnico': 'Tech support',
    'Punto estudiantil': 'Student hub', 'Oficinas y citas': 'Offices and appointments', 'Encuestas': 'Surveys', 'Egresados': 'Alumni', 'Bolsa de empleo': 'Job board',
    'Calendario': 'Calendar', 'Archivos': 'Files', 'Calificaciones': 'Grades', 'Asistencia': 'Attendance', 'Salas y recursos': 'Rooms and resources',
    'Personal y RR. HH.': 'Staff and HR', 'Inventario': 'Inventory', 'Reportes': 'Reports', 'Usuarios y roles': 'Users and roles', 'Configuración': 'Settings',
    'Centro de Ciberseguridad': 'Cybersecurity center', 'Auditoría': 'Audit log', 'Papelera': 'Trash', 'Actualizar sistema': 'Update system', 'Instituciones': 'Institutions', 'Plataformas y organizaciones': 'Platforms & organizations',
    'Sitio web y marca': 'Website and brand', 'Admisión web': 'Online admissions', 'Módulos y menú': 'Modules and menu', 'Mi cuenta': 'My account', 'Traductor': 'Translator',
  },
  pt: {
    'Inicio': 'Início', 'Mi portal': 'Meu portal', 'Mis pupilos': 'Meus dependentes', 'Mi credencial': 'Minha carteirinha', 'Mis boletas': 'Meus recibos', 'Mis secciones': 'Minhas turmas',
    'Estudiantes': 'Alunos', 'Profesores': 'Professores', 'Carreras y asignaturas': 'Cursos e disciplinas', 'Secciones y notas': 'Turmas e notas', 'Matrículas': 'Matrículas',
    'Finanzas': 'Finanças', 'SEMATEC VENTA': 'SEMATEC LOJA', 'Sucursales': 'Filiais', 'Certificados': 'Certificados', 'Aula de aprendizaje': 'Sala de aprendizagem',
    'Aulas virtuales': 'Salas virtuais', 'Anuncios': 'Avisos', 'Mensajes': 'Mensagens', 'Biblioteca': 'Biblioteca', 'Soporte técnico': 'Suporte técnico',
    'Punto estudiantil': 'Espaço do aluno', 'Oficinas y citas': 'Escritórios e agendamentos', 'Encuestas': 'Pesquisas', 'Egresados': 'Ex-alunos', 'Bolsa de empleo': 'Vagas de emprego',
    'Calendario': 'Calendário', 'Archivos': 'Arquivos', 'Calificaciones': 'Notas', 'Asistencia': 'Frequência', 'Salas y recursos': 'Salas e recursos',
    'Personal y RR. HH.': 'Pessoal e RH', 'Inventario': 'Inventário', 'Reportes': 'Relatórios', 'Usuarios y roles': 'Usuários e funções', 'Configuración': 'Configurações',
    'Centro de Ciberseguridad': 'Centro de cibersegurança', 'Auditoría': 'Auditoria', 'Papelera': 'Lixeira', 'Actualizar sistema': 'Atualizar sistema', 'Instituciones': 'Instituições', 'Plataformas y organizaciones': 'Plataformas e organizações',
    'Sitio web y marca': 'Site e marca', 'Admisión web': 'Admissão online', 'Módulos y menú': 'Módulos e menu', 'Mi cuenta': 'Minha conta', 'Traductor': 'Tradutor',
  },
  fr: {
    'Inicio': 'Accueil', 'Mi portal': 'Mon portail', 'Mis pupilos': 'Mes enfants', 'Mi credencial': 'Ma carte', 'Mis boletas': 'Mes reçus', 'Mis secciones': 'Mes groupes',
    'Estudiantes': 'Étudiants', 'Profesores': 'Enseignants', 'Carreras y asignaturas': 'Formations et matières', 'Secciones y notas': 'Groupes et notes', 'Matrículas': 'Inscriptions',
    'Finanzas': 'Finances', 'SEMATEC VENTA': 'SEMATEC BOUTIQUE', 'Sucursales': 'Succursales', 'Certificados': 'Certificats', 'Aula de aprendizaje': "Salle d'apprentissage",
    'Aulas virtuales': 'Classes virtuelles', 'Anuncios': 'Annonces', 'Mensajes': 'Messages', 'Biblioteca': 'Bibliothèque', 'Soporte técnico': 'Support technique',
    'Punto estudiantil': 'Espace étudiant', 'Oficinas y citas': 'Bureaux et rendez-vous', 'Encuestas': 'Sondages', 'Egresados': 'Anciens élèves', 'Bolsa de empleo': "Offres d'emploi",
    'Calendario': 'Calendrier', 'Archivos': 'Fichiers', 'Calificaciones': 'Notes', 'Asistencia': 'Présence', 'Salas y recursos': 'Salles et ressources',
    'Personal y RR. HH.': 'Personnel et RH', 'Inventario': 'Inventaire', 'Reportes': 'Rapports', 'Usuarios y roles': 'Utilisateurs et rôles', 'Configuración': 'Paramètres',
    'Centro de Ciberseguridad': 'Centre de cybersécurité', 'Auditoría': 'Audit', 'Papelera': 'Corbeille', 'Actualizar sistema': 'Mettre à jour', 'Instituciones': 'Établissements', 'Plataformas y organizaciones': 'Plateformes et organisations',
    'Sitio web y marca': 'Site web et marque', 'Admisión web': 'Admissions en ligne', 'Módulos y menú': 'Modules et menu', 'Mi cuenta': 'Mon compte', 'Traductor': 'Traducteur',
  },
};
/** Traduce un texto fijo del menú (si no hay traducción, queda en español y lo traduce el navegador). */
export const tNav = (locale: string | undefined, label: string) => (locale && NAV[locale]?.[label]) || label;
