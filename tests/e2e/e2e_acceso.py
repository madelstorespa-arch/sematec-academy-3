"""Acceso: avisos de intentos, bloqueo temporal (15 min), recuperar contraseña desbloquea, diagnóstico «¿Por qué no puede entrar?»
con sus soluciones (desbloquear, contraseña nueva, reiniciar MFA, enviar enlace) y compartir toda la pantalla."""
import re, sys, os, time, glob, email, email.header
sys.path.insert(0, os.path.dirname(__file__))
from e2e import BASE, CHROME, PASS, sql, check, login, status_msg, results
from playwright.sync_api import sync_playwright

ORG = '0a000000-0000-4000-8000-000000000001'
U = 'estudiante3.a@demo.sematec.test'
def go(page, url): page.goto(url); page.wait_for_load_state('load')
def reset_demo():
    sql("update auth.users set encrypted_password = extensions.crypt('Sematec-Demo-2026', extensions.gen_salt('bf')) where email like '%demo.sematec.test'")
    sql("update profiles set status = 'active', status_reason = null, locked_until = null where email like '%demo.sematec.test'")
    sql("delete from system_events where event_type in ('login_failed','rate:pwreset_ip','rate:pwreset_email') or (event_type like 'rate:%')")
def try_login(ctx, mail, pw):
    p = ctx.new_page(); go(p, f'{BASE}/login'); p.fill('input[name=email]', mail); p.fill('input[name=password]', pw); p.click('button[type=submit]')
    try: p.wait_for_url(re.compile(r'/(app|mfa)'), timeout=6000); return p, 'ENTRÓ'
    except Exception: return p, status_msg(p)
def mails_to(addr):
    out = []
    for f in sorted(glob.glob('/tmp/mails/*.eml')):
        raw = open(f, encoding='utf-8', errors='ignore', newline='').read()
        if addr in raw.split('\r\n', 1)[0]:
            msg = email.message_from_string(raw.split('\r\n', 1)[1]); body = ''
            for part in msg.walk():
                if part.get_content_type() == 'text/plain': body += part.get_payload(decode=True).decode('utf-8', 'ignore')
            out.append(body)
    return out

reset_demo()
for f in glob.glob('/tmp/mails/*.eml'): os.remove(f)
with sync_playwright() as pw:
    b = pw.chromium.launch(executable_path=CHROME, headless=True, args=['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--no-sandbox'])
    new = lambda: b.new_context(viewport={'width': 1366, 'height': 900})
    c = new()
    # ================= 1. Avisos y bloqueo temporal =================
    msgs = [try_login(c, U, 'ClaveEquivocada1')[1] for _ in range(4)]
    check('Le quedan 2 intento' in msgs[2] and 'Le quedan 1 intento' in msgs[3], f'Avisa cuántos intentos quedan ({msgs[3][:70]})')
    m = try_login(c, U, 'ClaveEquivocada1')[1]
    check('bloqueada 15 minutos' in m and '¿Olvidó su contraseña?' in m, 'Al 5º intento: bloqueo de 15 minutos y cómo salir de él')
    m = try_login(c, U, PASS)[1]
    check('bloqueada' in m and 'hasta las' in m, f'Con la contraseña correcta explica hasta qué hora está bloqueada ({m[:70]})')
    sql(f"update profiles set locked_until = now() - interval '1 minute' where email = '{U}'")
    check(try_login(c, U, PASS)[1] == 'ENTRÓ', 'Pasado el tiempo, la cuenta se desbloquea sola')
    # ================= 2. Recuperar la contraseña desbloquea =================
    reset_demo()
    for _ in range(5): try_login(c, U, 'ClaveEquivocada1')
    check(sql(f"select status from profiles where email = '{U}'") == 'locked', 'Cuenta bloqueada por intentos')
    r = c.new_page(); go(r, f'{BASE}/recuperar'); r.fill('input[name=email]', U); r.click('button:has-text("Enviar enlace")'); status_msg(r); time.sleep(1.5)
    body = (mails_to(U) or [''])[-1]; link = re.search(r'(http\S+/auth/confirm\?token_hash=\S+type=recovery)', body)
    check(bool(link), 'Una cuenta bloqueada por intentos SÍ recibe el enlace de recuperación')
    o2 = new().new_page(); go(o2, link.group(1)); o2.wait_for_url(re.compile(r'/cambiar-clave'), timeout=20000)
    o2.fill('input[name=password]', 'RecuperadaClave2026'); o2.fill('input[name=confirm]', 'RecuperadaClave2026'); o2.click('button:has-text("Guardar contraseña")'); status_msg(o2)
    check(sql(f"select status from profiles where email = '{U}'") == 'active' and try_login(new(), U, 'RecuperadaClave2026')[1] == 'ENTRÓ', 'Crear la contraseña nueva desbloquea la cuenta y puede entrar')

    # ================= 3. ¿Por qué no puede entrar? =================
    reset_demo()
    oc = new(); o = login(oc, 'propietario.a@demo.sematec.test', mfa=True)
    go(o, f'{BASE}/app/usuarios?revisar=nadie.existe@demo.sematec.test')
    check('No existe ninguna cuenta' in o.locator('[data-testid=diagnostico-resultado]').inner_text(), 'Correo sin cuenta: lo indica')
    sql(f"insert into students (organization_id, student_code, first_names, last_names, email) values ('{ORG}', 'EST-SINCTA', 'Sin', 'Cuenta', 'sin.cuenta@demo.sematec.test') on conflict do nothing")
    go(o, f'{BASE}/app/usuarios?revisar=sin.cuenta@demo.sematec.test')
    check('NO tiene cuenta' in o.locator('[data-testid=diagnostico-resultado]').inner_text(), 'Ficha sin cuenta: explica que falta crear la cuenta')
    for _ in range(5): try_login(c, U, 'ClaveEquivocada1')
    go(o, f'{BASE}/app/usuarios?revisar={U}')
    res = o.locator('[data-testid=diagnostico-resultado]').inner_text()
    check('Bloqueada por varios intentos fallidos' in res and 'intento(s) fallido(s)' in res, 'Diagnóstico: bloqueo por intentos y cuántos fallos hubo')
    o.locator('button:has-text("Desbloquear")').click(); status_msg(o)
    check(sql(f"select status from profiles where email = '{U}'") == 'active', '🔓 Desbloquear con un botón')
    go(o, f'{BASE}/app/usuarios?revisar={U}')
    o.locator('[data-testid=diagnostico-resultado] input[name=password]').fill('DesdeAdmin2026x'); o.locator('button:has-text("Poner una contraseña nueva")').click()
    check('Contraseña nueva guardada' in status_msg(o) and try_login(new(), U, 'DesdeAdmin2026x')[1] == 'ENTRÓ', '🔑 El propietario pone una contraseña nueva y la persona entra')
    o.locator('button:has-text("Enviar enlace de recuperación")').click()
    st = o.locator('form:has(button:has-text("Enviar enlace de recuperación")) [role=status]'); st.wait_for(timeout=20000); m = st.inner_text(); time.sleep(1)
    check('Enlace enviado' in m and len(mails_to(U)) >= 2, f'✉ Envía el enlace de recuperación desde el diagnóstico ({m[:80]} · {len(mails_to(U))} correos)')
    sec_id = sql("select id from auth.users where email = 'secretaria.a@demo.sematec.test'")
    sql(f"insert into auth.mfa_factors (id, user_id, friendly_name, factor_type, status, created_at, updated_at, secret) values (gen_random_uuid(), '{sec_id}', 'Celular E2E', 'totp', 'verified', now(), now(), 'JBSWY3DPEHPK3PXP')")
    check(sql(f"select count(*) from auth.mfa_factors where user_id = '{sec_id}' and status = 'verified'") == '1', 'Funcionaria con verificación en dos pasos')
    go(o, f'{BASE}/app/usuarios?revisar=secretaria.a@demo.sematec.test')
    check('perdió el celular' in o.locator('[data-testid=diagnostico-resultado]').inner_text(), 'Diagnóstico: usa verificación en dos pasos')
    o.once('dialog', lambda d: d.accept()); o.locator('button:has-text("Reiniciar verificación en dos pasos")').click(); m = status_msg(o)
    check('reiniciada' in m and sql(f"select count(*) from auth.mfa_factors where user_id = '{sec_id}'") == '0', '🔄 Reinicia la verificación en dos pasos (perdió el celular)')
    sql(f"update memberships set status = 'revoked' where user_id = (select id from auth.users where email = '{U}') and organization_id = '{ORG}'")
    go(o, f'{BASE}/app/usuarios?revisar={U}')
    check('No tiene ningún rol activo' in o.locator('[data-testid=diagnostico-resultado]').inner_text(), 'Diagnóstico: sin rol activo')
    sql(f"update memberships set status = 'active' where user_id = (select id from auth.users where email = '{U}') and organization_id = '{ORG}'")
    ec = new(); e = login(ec, 'estudiante1.a@demo.sematec.test')
    go(e, f'{BASE}/app/usuarios?revisar={U}'); check('/app/usuarios' not in e.url or e.locator('[data-testid=diagnostico]').count() == 0, 'Un estudiante no puede usar el diagnóstico')

    # ================= 4. Compartir toda la pantalla =================
    T1 = '00000000-0000-4000-8000-000000000020'; SEC = '0a000000-0000-4000-8000-00000000ad01'
    sql(f"insert into section_enrollments (organization_id, section_id, student_id, enrollment_id) select '{ORG}', '{SEC}', e.student_id, e.id from enrollments e join students s on s.id = e.student_id where s.organization_id = '{ORG}' and s.user_id is not null on conflict do nothing")
    room = sql(f"insert into conference_rooms (organization_id, name, room_type, section_id, max_participants, created_by) values ('{ORG}', 'Aula Acceso E2E', 'class', '{SEC}', 50, '{T1}') returning id").splitlines()[0]
    sess = sql(f"""set request.jwt.claims = '{{"sub":"{T1}","role":"authenticated"}}'; select create_conference_session('{room}', 'Pantalla completa E2E', 'class', now() - interval '5 minutes', now() + interval '55 minutes', 'America/Santiago', true, null)""").splitlines()[-1]
    tc = new(); t = login(tc, 'profesor1.a@demo.sematec.test')
    for p in (t, e):
        go(p, f'{BASE}/app/conferencias/sala/{sess}'); p.click('button:has-text("Entrar a la sala")'); p.wait_for_selector('.lk-video-conference', timeout=30000)
    t.locator('footer button:has-text("Compartir pantalla")').click()
    opts = t.locator('[data-testid=opciones-compartir]')
    check('Toda la pantalla' in opts.inner_text() and 'navegar por todo su equipo' in opts.inner_text() and opts.locator('input[name=superficie]').first.is_checked(),
          'Opción «Toda la pantalla» (navegar por todo el equipo) marcada por defecto')
    t.locator('button:has-text("Elegir qué compartir")').click()
    t.wait_for_selector('[data-testid=compartiendo]', timeout=20000); e.wait_for_selector('[data-testid=pantalla-de]', timeout=20000); time.sleep(3)
    dims = e.evaluate("[...document.querySelectorAll('.lk-focus-layout video')].map(v => v.videoWidth)")
    check(any(w >= 1280 for w in dims), f'Los demás ven la pantalla completa del profesor ({dims})')
    reset_demo()
    b.close()

print(f"\n{sum(1 for r in results if r[0])}/{len(results)} verificaciones OK")
