import 'server-only';
import crypto from 'node:crypto';
import { Client } from 'pg';
import { MIGRATIONS, DEMO_SQL, DEMO_USERS_SQL } from './sql.generated';

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
      // Reparación idempotente: Supabase Auth no acepta columnas de token en NULL,
      // y los usuarios demo bloqueados por intentos fallidos se reactivan.
      const fixed = await c.query(`update auth.users set
          confirmation_token = coalesce(confirmation_token, ''), recovery_token = coalesce(recovery_token, ''),
          email_change_token_new = coalesce(email_change_token_new, ''), email_change = coalesce(email_change, ''),
          email_change_token_current = coalesce(email_change_token_current, ''), phone_change = coalesce(phone_change, ''),
          phone_change_token = coalesce(phone_change_token, ''), reauthentication_token = coalesce(reauthentication_token, '')
        where email like '%@demo.sematec.test'
          and (confirmation_token is null or recovery_token is null or email_change_token_new is null or email_change is null
               or email_change_token_current is null or phone_change is null or phone_change_token is null or reauthentication_token is null)`);
      const unlocked = await c.query(`update public.profiles p set status = 'active', status_reason = null
        from auth.users u where u.id = p.id and u.email like '%@demo.sematec.test' and p.status = 'locked'`);
      log.push(`✓ Acceso de usuarios demo verificado (${fixed.rowCount ?? 0} reparados, ${unlocked.rowCount ?? 0} desbloqueados)`);
      // Diagnóstico y reparación por usuario: existencia, contraseña demo e identidad de correo
      await c.query('begin'); await c.query(DEMO_USERS_SQL); await c.query('commit');
      const pw = await c.query(`update auth.users set encrypted_password = extensions.crypt('Sematec-Demo-2026', extensions.gen_salt('bf')),
          email_confirmed_at = coalesce(email_confirmed_at, now()), banned_until = null
        where email like '%@demo.sematec.test'
          and (encrypted_password is null or encrypted_password <> extensions.crypt('Sematec-Demo-2026', encrypted_password)
               or email_confirmed_at is null or banned_until is not null)`);
      const d = (await c.query(`select count(*)::int as users,
          count(*) filter (where encrypted_password = extensions.crypt('Sematec-Demo-2026', encrypted_password))::int as pass_ok,
          count(*) filter (where exists (select 1 from auth.identities i where i.user_id = u.id and i.provider = 'email'))::int as ident_ok,
          count(*) filter (where exists (select 1 from public.profiles p where p.id = u.id and p.status = 'active'))::int as active
        from auth.users u where u.email like '%@demo.sematec.test'`)).rows[0];
      log.push(`✓ Usuarios demo: ${d.users} en Auth · ${d.pass_ok} con contraseña demo · ${d.ident_ok} con identidad · ${d.active} activos · ${pw.rowCount ?? 0} contraseñas restablecidas`);
    }
    await c.query("notify pgrst, 'reload schema'");
    return log;
  } finally { await c.end(); }
}
