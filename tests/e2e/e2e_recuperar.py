"""Recuperar contraseña para TODOS: con correo o RUT, y «No tengo acceso a mi correo» con ayuda de la administración."""
import re, sys, os, time, glob, email
sys.path.insert(0, os.path.dirname(__file__))
from e2e import BASE, CHROME, sql, check, login, status_msg, go, results
from playwright.sync_api import sync_playwright

def mails_to(addr):
    out = []
    for f in sorted(glob.glob('/tmp/mails/*.eml')):
        raw = open(f, encoding='utf-8', errors='ignore', newline='').read()
        if addr in raw.split('\r\n', 1)[0]:
            msg = email.message_from_string(raw.split('\r\n', 1)[1])
            body = ''
            for part in msg.walk():
                if part.get_content_type() == 'text/plain': body += part.get_payload(decode=True).decode('utf-8', 'ignore')
            out.append((str(email.header.make_header(email.header.decode_header(msg['Subject']))), body))
    return out
def link_in(body):
    m = re.search(r'(http\S+/auth/confirm\?token_hash=\S+type=recovery)', body); return m.group(1) if m else None
def form_msg(form, timeout=15):
    end = time.time() + timeout
    while time.time() < end:
        t = ' '.join(form.locator('[role=status]').all_inner_texts()).strip()
        if t: return t
        time.sleep(0.2)
    return ''
def manual_login(ctx, who, pw):
    p = ctx.new_page(); go(p, f'{BASE}/login'); p.fill('input[name=email]', who); p.fill('input[name=password]', pw); p.click('button[type=submit]')
    p.wait_for_url(re.compile(r'/app'), timeout=20000); return p

E2 = 'estudiante2.a@demo.sematec.test'; E3 = 'estudiante3.a@demo.sematec.test'
sql(f"update profiles set id_document_type = 'RUN', id_document_number = '19.876.543-0' where email = '{E2}' and id_document_number is null")
sql("delete from password_help_requests")
for f in glob.glob('/tmp/mails/*.eml'): os.remove(f)

with sync_playwright() as pw:
    b = pw.chromium.launch(executable_path=CHROME, headless=True, args=['--no-sandbox'])
    new = lambda: b.new_context(viewport={'width': 1280, 'height': 900})

    # ---------- 1. Estudiante recupera con su RUT ----------
    c = new(); r = c.new_page(); go(r, f'{BASE}/login'); r.click('text=¿Olvidó su contraseña?'); r.wait_for_url(re.compile('/recuperar'))
    check('correo o rut' in r.locator('[data-testid=recuperar-correo]').inner_text().lower(), '🔑 La recuperación acepta correo o RUT, para todos los usuarios')
    r.fill('input[name=email]', '19876543-0'); r.click('button:has-text("Enviar enlace")'); m = status_msg(r); time.sleep(1.5)
    ms = mails_to(E2)
    check('recibirá' in m and len(ms) == 1, f'🎓 El estudiante escribe su RUT y le llega el enlace a su correo ({m[:40]})')
    lnk = link_in(ms[0][1]) if ms else None
    go(r, lnk.replace('http://localhost:3000', BASE)); r.wait_for_url(re.compile('/cambiar-clave'), timeout=20000)
    r.fill('input[name=password]', 'NuevaClaveRut2026'); r.fill('input[name=confirm]', 'NuevaClaveRut2026'); r.click('button:has-text("Guardar contraseña")')
    check('actualizada' in status_msg(r), '🎓 Crea su contraseña nueva')
    c.close(); c = new(); manual_login(c, '19.876.543-0', 'NuevaClaveRut2026'); check(True, '🎓 Entra con su RUT y la contraseña nueva'); c.close()

    # ---------- 2. RUT inexistente: misma respuesta, sin envío ----------
    c = new(); r = c.new_page(); go(r, f'{BASE}/recuperar')
    r.fill('input[name=email]', '5.126.663-3'); r.click('button:has-text("Enviar enlace")'); m = status_msg(r)
    check('recibirá' in m and len(glob.glob('/tmp/mails/*.eml')) == 1, '🔒 RUT no registrado: misma respuesta y ningún correo (no revela quién tiene cuenta)')
    r.fill('input[name=email]', '123'); r.click('button:has-text("Enviar enlace")'); m = status_msg(r)
    check('no es válido' in m or 'RUT' in m, '✋ Valida lo que se escribe (RUT incompleto)')

    # ---------- 3. «No tengo acceso a mi correo» ----------
    r.click('[data-testid=sin-correo] summary')
    f = r.locator('[data-testid=sin-correo] form')
    f.locator('input[name=identifier]').fill(E3); f.locator('input[name=full_name]').fill('Estudiante Tres'); f.locator('input[name=contact]').fill('+56 9 8765 4321')
    f.locator('select[name=reason]').select_option('no_llega'); f.locator('textarea[name=message]').fill('Cambié de correo')
    f.locator('button:has-text("Pedir ayuda")').click(); m = form_msg(f)
    check('administración' in m, '🆘 Sin acceso al correo: envía una solicitud a la administración')
    row = sql(f"select status || '|' || (user_id is not null) || '|' || (organization_id is not null) from password_help_requests where identifier = '{E3}'")
    check(row == 'pendiente|true|true', '🆘 La solicitud queda vinculada a su cuenta e institución')
    def ask_unknown():
        f.locator('input[name=identifier]').fill('99.999.999-9'); f.locator('input[name=full_name]').fill('Persona Desconocida'); f.locator('input[name=contact]').fill('+56 9 1111 2222')
        f.locator('button:has-text("Pedir ayuda")').click(); time.sleep(1.5)
    for _ in range(4): ask_unknown()
    m = form_msg(f)
    check('varias solicitudes' in m, '🛡 Límite de solicitudes para evitar abusos')
    c.close()

    # ---------- 4. La administración ve y resuelve ----------
    sc = new(); s = login(sc, 'secretaria.a@demo.sematec.test')
    go(s, f'{BASE}/app/usuarios')
    check(s.locator('[data-testid=solicitudes-clave]').count() == 0, '🔒 Quien no administra usuarios no ve las solicitudes'); sc.close()
    oc = new(); o = login(oc, 'propietario.a@demo.sematec.test', mfa=True)
    check(re.search(r'🔑 \d', o.locator('aside nav').first.inner_text()) is not None, '🔔 El propietario ve en el menú que hay personas pidiendo ayuda')
    go(o, f'{BASE}/app/usuarios')
    panel = o.locator('[data-testid=solicitudes-clave]').inner_text()
    check('Estudiante Tres' in panel and '+56 9 8765 4321' in panel and 'No se encontró una cuenta' in panel, '🧾 Ve nombre, contacto, motivo y si la cuenta existe')
    item = o.locator('[data-testid=solicitud-clave]:has-text("Estudiante Tres")')
    temp = item.locator('[data-testid=clave-temporal]').input_value()
    check(len(temp) >= 12 and re.search(r'[A-Z]', temp) and re.search(r'\d', temp), f'🔑 Propone una contraseña temporal segura y fácil de dictar ({temp})')
    item.locator('button:has-text("Dar esta contraseña temporal")').click(); m = status_msg(o)
    check('Contraseña nueva guardada' in m and sql(f"select status from password_help_requests where identifier = '{E3}'") == 'resuelta', '✅ La entrega y la solicitud queda resuelta')
    while o.locator('[data-testid=solicitud-clave]:has-text("Persona Desconocida")').count():
        n = o.locator('[data-testid=solicitud-clave]').count()
        o.locator('[data-testid=solicitud-clave]:has-text("Persona Desconocida") button:has-text("Descartar")').first.click()
        end = time.time() + 15
        while o.locator('[data-testid=solicitud-clave]').count() == n and time.time() < end: time.sleep(0.3)
    check(sql("select count(*) from password_help_requests where status = 'pendiente'") == '0', '🗂 Descarta la solicitud de alguien sin cuenta')
    oc.close()
    c = new(); manual_login(c, E3, temp); check(True, '🎓 El estudiante entra con la contraseña temporal (y luego la cambia en «Mi cuenta»)'); c.close()

ok = sum(1 for r in results if r[0]); print(f'\n{ok}/{len(results)} verificaciones OK')
