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
export type FirstInstitution = { name: string; adminName: string; email: string; password: string };

export async function runInstall(withDemo: boolean, first?: FirstInstitution) {
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
    if (!withDemo && first) log.push(await createFirstInstitution(c, first));
    await c.query("notify pgrst, 'reload schema'");
    return log;
  } finally { await c.end(); }
}

/**
 * Instalación real (sin demo): crea la primera institución, su sede principal, la escala
 * de notas chilena, la configuración del sitio y la cuenta del administrador (propietario y
 * superadministrador de la plataforma). Solo funciona si aún no existe ninguna institución.
 */
async function createFirstInstitution(c: Client, f: FirstInstitution): Promise<string> {
  const email = f.email.trim().toLowerCase();
  const name = f.name.trim(); const adminName = f.adminName.trim();
  if (!name || !adminName) throw new Error('Complete el nombre de la academia y del administrador.');
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error('Correo del administrador inválido.');
  if (f.password.length < 12 || !/[A-Z]/.test(f.password) || !/[a-z]/.test(f.password) || !/[0-9]/.test(f.password))
    throw new Error('La contraseña debe tener al menos 12 caracteres, con mayúsculas, minúsculas y números.');
  const n = (await c.query('select count(*)::int as n from public.organizations')).rows[0].n;
  if (n > 0) return '• Institución: ya existe (no se creó otra)';
  const slug = name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'academia';
  await c.query('begin');
  try {
    const exists = (await c.query('select id from auth.users where lower(email) = $1', [email])).rows[0];
    let uid: string = exists?.id;
    if (!uid) {
      uid = (await c.query(`insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
          raw_app_meta_data, raw_user_meta_data, created_at, updated_at, confirmation_token, recovery_token,
          email_change_token_new, email_change, email_change_token_current, phone_change, phone_change_token, reauthentication_token)
        values ('00000000-0000-0000-0000-000000000000', gen_random_uuid(), 'authenticated', 'authenticated', $1,
          extensions.crypt($2, extensions.gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}',
          jsonb_build_object('full_name', $3::text), now(), now(), '', '', '', '', '', '', '', '')
        returning id`, [email, f.password, adminName])).rows[0].id;
      await c.query(`insert into auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
        values (gen_random_uuid(), $1::uuid, $3::text, jsonb_build_object('sub', $3::text, 'email', $2::text, 'email_verified', true), 'email', now(), now(), now())`, [uid, email, String(uid)]);
    }
    await c.query('update public.profiles set full_name = $2, is_platform_admin = true, status = $3 where id = $1', [uid, adminName, 'active']);
    const org = (await c.query(`insert into public.organizations (slug, legal_name, display_name, country_code, base_currency, timezone)
      values ($1, $2, $2, 'CL', 'CLP', 'America/Santiago') returning id`, [slug, name])).rows[0].id;
    await c.query(`insert into public.campuses (organization_id, code, name, country_code, city, timezone)
      values ($1, 'PRINCIPAL', 'Sede principal', 'CL', 'Santiago', 'America/Santiago')`, [org]);
    await c.query(`insert into public.grade_scales (organization_id, name, min_grade, max_grade, passing_grade, decimals)
      values ($1, 'Chile 1.0 - 7.0', 1.0, 7.0, 4.0, 1)`, [org]);
    await c.query(`insert into public.memberships (user_id, organization_id, role_id)
      select $1, $2, id from public.roles where organization_id is null and code = 'propietario_institucional'`, [uid, org]);
    await c.query(`insert into public.site_settings (organization_id, site_name, tagline, hero_title, hero_subtitle, contact_email, is_published)
      values ($1, $2, 'Formación técnica y profesional', $2, 'Conoce nuestros cursos e inscríbete en línea.', $3, false)
      on conflict (organization_id) do nothing`, [org, name, email]);
    await c.query('commit');
  } catch (e) { await c.query('rollback'); throw e; }
  return `✓ Institución «${name}» y administrador ${email} creados`;
}
