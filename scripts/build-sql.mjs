// Empaqueta las migraciones y los datos de demostración para el instalador web (/instalar).
// Se ejecuta automáticamente antes de `npm run build`.
import fs from 'node:fs';
import path from 'node:path';
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const dir = path.join(root, 'supabase/migrations');
const migrations = fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()
  .map((f) => ({ version: f.split('_')[0], name: f.replace(/^\d+_/, '').replace(/\.sql$/, ''), sql: fs.readFileSync(path.join(dir, f), 'utf8') }));
const demoUsers = fs.readFileSync(path.join(root, 'supabase/demo/usuarios_demo.sql'), 'utf8');
const demo = demoUsers + '\n' + fs.readFileSync(path.join(root, 'supabase/seed.sql'), 'utf8');
const out = `// ARCHIVO GENERADO por scripts/build-sql.mjs — no editar a mano.\nexport const MIGRATIONS: { version: string; name: string; sql: string }[] = ${JSON.stringify(migrations)};\nexport const DEMO_SQL: string = ${JSON.stringify(demo)};\nexport const DEMO_USERS_SQL: string = ${JSON.stringify(demoUsers)};\n`;
fs.mkdirSync(path.join(root, 'lib/setup'), { recursive: true });
fs.writeFileSync(path.join(root, 'lib/setup/sql.generated.ts'), out);
console.log(`Instalador: ${migrations.length} migraciones empaquetadas.`);

// Versión de esta publicación (la misma para el servidor y el navegador): si cambia, la app ofrece «Actualizar ahora»
const version = (process.env.VERCEL_GIT_COMMIT_SHA ?? '').slice(0, 7) || `local-${Date.now().toString(36)}`;
fs.writeFileSync(path.join(root, 'lib/version.generated.ts'),
  `// ARCHIVO GENERADO por scripts/build-sql.mjs — no editar a mano.\nexport const APP_VERSION = ${JSON.stringify(version)};\nexport const APP_BUILT = ${JSON.stringify(new Date().toISOString())};\n`);
console.log(`Versión: ${version}`);
