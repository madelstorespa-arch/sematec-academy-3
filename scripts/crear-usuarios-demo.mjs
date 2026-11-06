// Crea en Supabase Auth los usuarios de demostración del seed, con contraseña.
// SOLO para entornos locales o de prueba. Se niega a ejecutarse contra un proyecto de producción
// salvo que se indique ALLOW_DEMO_USERS=1 explícitamente.
//   node --env-file=.env.local scripts/crear-usuarios-demo.mjs
import { createClient } from '@supabase/supabase-js';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) { console.error('Defina NEXT_PUBLIC_SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY'); process.exit(1); }
if (!/localhost|127\.0\.0\.1/.test(url) && process.env.ALLOW_DEMO_USERS !== '1') {
  console.error('Abortado: esto parece un proyecto real. Use ALLOW_DEMO_USERS=1 solo en un proyecto de pruebas.'); process.exit(1);
}
const PASSWORD = process.env.DEMO_PASSWORD ?? 'Sematec-Demo-2026';
const users = [
  ['01', 'superadmin', 'Superadministrador Demo'], ['10', 'propietario.a', 'Propietaria Institución A'],
  ['11', 'secretaria.a', 'Secretaria Académica A'], ['12', 'tesoreria.a', 'Tesorero A'], ['13', 'director.a', 'Director Académico A'],
  ['14', 'auditor.a', 'Auditora A'], ['15', 'soporte.a', 'Soporte Técnico A'], ['16', 'matriculas.a', 'Matrículas A'],
  ['20', 'profesor1.a', 'Profesor Uno'], ['21', 'profesor2.a', 'Profesora Dos'], ['30', 'estudiante1.a', 'Estudiante Uno'],
  ['31', 'estudiante2.a', 'Estudiante Dos'], ['32', 'estudiante3.a', 'Estudiante Tres'], ['40', 'postulante', 'Postulante Externo'],
  ['50', 'propietario.b', 'Propietario Institución B'], ['51', 'estudiante1.b', 'Estudiante B Uno'],
];
const admin = createClient(url, key, { auth: { persistSession: false } });
for (const [n, local, name] of users) {
  const id = `00000000-0000-4000-8000-0000000000${n}`;
  const email = `${local}@demo.sematec.test`;
  const { error } = await admin.auth.admin.createUser({ id, email, password: PASSWORD, email_confirm: true, user_metadata: { full_name: name } });
  console.log(error ? `· ${email}: ${error.message}` : `✓ ${email}`);
}
console.log(`\nContraseña de todos los usuarios demo: ${PASSWORD}\nAhora cargue supabase/seed.sql.`);
