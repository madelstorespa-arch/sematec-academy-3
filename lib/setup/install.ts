import 'server-only';
import crypto from 'node:crypto';
import { Client } from 'pg';
import { MIGRATIONS, DEMO_SQL } from './sql.generated';

export const setupEnabled = () => !!process.env.SETUP_TOKEN && !!process.env.DATABASE_URL;

export function tokenOk(given: string): boolean {
  const real = process.env.SETUP_TOKEN ?? '';
  if (!real || real.length < 12) return false;
  const a = crypto.createHash('sha256').update(given).digest(), b = crypto.createHash('sha256').update(real).digest();
  return crypto.timingSafeEqual(a, b);
}

function client() {
  const url = process.env.DATABASE_URL!;
  const local = /@(localhost|127\.0\.0\.1)[:/]/.test(url);
  // El pooler de Supabase exige TLS; el certificado se valida contra la cadena de Supabase si se entrega en DATABASE_CA_CERT.
  return new Client({ connectionString: url, ssl: local ? false : process.env.DATABASE_CA_CERT ? { ca: process.env.DATABASE_CA_CERT } : { rejectUnauthorized: false } });
}

export async function installStatus() {
  const c = client(); await c.connect();
  try {
    const r = await c.query("select to_regclass('public.organizations') is not null as installed, to_regclass('auth.users') is not null as has_auth");
    return r.rows[0] as { installed: boolean; has_auth: boolean };
  } finally { await c.end(); }
}

/** Aplica las migraciones pendientes (cada una en su transacción) y, opcionalmente, los datos de demostración. */
export async function runInstall(withDemo: boolean) {
  const c = client(); await c.connect();
  const log: string[] = [];
  try {
    await c.query('create schema if not exists supabase_migrations');
    await c.query('create table if not exists supabase_migrations.schema_migrations (version text primary key, statements text[], name text)');
    const done = new Set((await c.query('select version from supabase_migrations.schema_migrations')).rows.map((r) => r.version));
    for (const m of MIGRATIONS) {
      if (done.has(m.version)) { log.push(`• ${m.name}: ya aplicada`); continue; }
      try {
        await c.query('begin');
        await c.query(m.sql);
        await c.query('insert into supabase_migrations.schema_migrations (version, name, statements) values ($1, $2, $3)', [m.version, m.name, [m.sql]]);
        await c.query('commit');
        log.push(`✓ ${m.name}`);
      } catch (e) {
        await c.query('rollback');
        throw new Error(`Falló la migración «${m.name}»: ${(e as Error).message}`);
      }
    }
    if (withDemo) {
      const exists = (await c.query("select count(*)::int as n from public.organizations where slug = 'sematec-demo-cl'")).rows[0].n > 0;
      if (exists) log.push('• Datos de demostración: ya cargados');
      else {
        await c.query('begin'); await c.query(DEMO_SQL); await c.query('commit');
        log.push('✓ Datos y usuarios de demostración');
      }
    }
    await c.query("notify pgrst, 'reload schema'");
    return log;
  } finally { await c.end(); }
}
