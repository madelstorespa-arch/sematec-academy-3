"""
Inscripción ampliada, correos reales y «ocultar para / por»:
 · Inscripción con curso o carrera, jornada (día/noche) y modalidad
 · Pago: enviar comprobante (con revisión y aprobación) o pagar en la oficina (rechazo con motivo)
 · Correos: a la persona y a la institución; aprobación con enlace para crear la contraseña; registro de correos
 · Recuperar la contraseña desde el inicio de sesión de verdad (enlace → nueva clave → entra)
 · Casilla «Enviar también por correo» en mensajes, anuncios, solicitudes y respuestas
 · Ocultar un anuncio a estudiantes por una semana y volver a mostrarlo; Mapa de la plataforma
"""
import email, glob, io, os, re, sys, time
from email import policy
sys.path.insert(0, os.path.dirname(__file__))
from e2e import BASE, CHROME, sql, check, shot, login, go, status_msg, results
from playwright.sync_api import sync_playwright

ORG = '0a000000-0000-4000-8000-000000000001'

def until(fn, timeout=20, msg=''):
    end = time.time() + timeout
    while time.time() < end:
        try:
            if fn(): return True
        except Exception: pass
        time.sleep(0.4)
    raise AssertionError(f'Tiempo agotado: {msg}')

def mails(addr):
    """Correos recibidos por el servidor SMTP de prueba para esa dirección: [(asunto, texto)]."""
    out = []
    for f in sorted(glob.glob('/tmp/mails/*.eml')):
        raw = open(f, 'rb').read()
        first, rest = raw.split(b'\r\n', 1)
        if addr.encode() not in first: continue
        m = email.message_from_bytes(rest, policy=policy.default)
        body = m.get_body(preferencelist=('plain',))
        out.append((str(m['subject']), body.get_content() if body else ''))
    return out

def main():
    os.makedirs('/tmp/mails', exist_ok=True)
    for f in glob.glob('/tmp/mails/*.eml'): os.remove(f)
    from PIL import Image
    tmp = '/tmp/e2e_insc'; os.makedirs(tmp, exist_ok=True)
    rec = os.path.join(tmp, 'comprobante.png'); Image.new('RGB', (400, 300), (240, 240, 240)).save(rec)
    fake = os.path.join(tmp, 'falso.png'); open(fake, 'w').write('esto no es una imagen')
    with sync_playwright() as pw:
        b = pw.chromium.launch(executable_path=CHROME, headless=True, args=['--no-sandbox'])
        new = lambda: b.new_context(viewport={'width': 1440, 'height': 900}, accept_downloads=True)
        oc = new(); o = login(oc, 'propietario.a@demo.sematec.test', mfa=True)

        # ================= Configurar la inscripción =================
        go(o, f'{BASE}/app/inscripciones')
        o.check('[data-testid=inscripcion-activa]'); o.fill('input[name=fee]', '20000'); o.fill('input[name=title]', 'Inscripción 2027')
        o.fill('input[name=shifts]', 'Día, Noche'); o.fill('input[name=modalities]', 'Presencial, En línea')
        o.fill('textarea[name=bank_info]', 'Banco Estado · Cuenta Vista 123456789\nRUT 76.123.456-7'); o.fill('textarea[name=office_info]', 'Av. Principal 123 · lunes a viernes 9:00 a 18:00')
        o.fill('input[name=notify_email]', 'caja@demo.sematec.test')
        o.click('button:has-text("Guardar")'); check('20.000' in status_msg(o), 'Inscripción configurada: monto, jornadas, modalidades, datos de transferencia y oficina')

        # ================= Inscripción con comprobante =================
        c = new(); p = c.new_page(); go(p, f'{BASE}/inscripcion')
        opts = p.locator('[data-testid=elegir-programa] option').all_inner_texts()
        check(len(opts) >= 3 and any('decido' in x for x in opts), f'Puede elegir curso o carrera ({len(opts) - 2} opciones)')
        check(p.locator('[data-testid^=jornada-]').count() == 2 and p.locator('[data-testid=elegir-modalidad] option').count() == 2, 'Elige jornada (Día / Noche) y modalidad')
        check('20.000' in p.locator('[data-testid=monto-a-pagar]').inner_text(), 'Muestra el monto a pagar')
        prog_value = p.locator('[data-testid=elegir-programa] option').nth(1).get_attribute('value'); prog_name = opts[1]
        p.select_option('[data-testid=elegir-programa]', prog_value); p.check('[data-testid=jornada-1]'); p.select_option('[data-testid=elegir-modalidad]', 'En línea')
        p.fill('input[name=name]', 'Marta Comprobante'); p.fill('input[name=email]', 'marta.comp@demo.sematec.test'); p.fill('input[name=doc_number]', '17.171.717-5')
        p.check('[data-testid=pago-transfer] input')
        check('Banco Estado' in p.locator('[data-testid=datos-transferencia]').inner_text(), 'Al elegir «enviar comprobante» muestra los datos para transferir')
        p.set_input_files('[data-testid=comprobante]', fake); p.check('input[name=consent]')
        p.click('button:has-text("Enviar inscripción con comprobante")')
        check('comprobante válido' in status_msg(p), 'Un archivo que no es imagen ni PDF se rechaza')
        p.set_input_files('[data-testid=comprobante]', rec); p.fill('input[name=reference]', 'OP-555')
        p.click('button:has-text("Enviar inscripción con comprobante")')
        p.wait_for_selector('[data-testid=inscripcion-pendiente]', timeout=20000); shot(p, 'insc_01_pendiente')
        check('verificaremos' in p.inner_text('body').lower(), 'Pantalla: inscripción recibida en revisión, con código')
        row = sql("select method||'|'||status||'|'||(receipt_path is not null)||'|'||(form_data->>'shift')||'|'||(form_data->>'modality')||'|'||amount::int||'|'||reference from registration_requests where email='marta.comp@demo.sematec.test'")
        check(row == 'transfer|pending|true|Noche|En línea|20000|OP-555', f'Solicitud guardada con comprobante, jornada y modalidad ({row})')
        check(sql("select form_data->>'program' from registration_requests where email='marta.comp@demo.sematec.test'") == prog_name, 'Guarda el curso o carrera elegido')
        until(lambda: mails('marta.comp@demo.sematec.test'), 15, 'correo postulante')
        subj, body = mails('marta.comp@demo.sematec.test')[0]
        check('inscripción recibida' in subj and 'Noche' in body and 'Código de seguimiento' in body, 'Correo REAL a la persona con su código, jornada y curso')
        until(lambda: mails('caja@demo.sematec.test'), 15, 'correo caja')
        check('comprobante' in mails('caja@demo.sematec.test')[0][0], 'Correo a la institución: nueva inscripción por verificar')
        c.close()

        # ================= Inscripción para pagar en la oficina =================
        c = new(); p = c.new_page(); go(p, f'{BASE}/inscripcion')
        p.select_option('[data-testid=elegir-programa]', 'otro'); p.check('[data-testid=jornada-0]')
        p.fill('input[name=name]', 'Pedro Oficina'); p.fill('input[name=email]', 'pedro.ofi@demo.sematec.test'); p.fill('input[name=doc_number]', '16.161.616-8')
        p.check('[data-testid=pago-office] input')
        check('Av. Principal 123' in p.locator('[data-testid=datos-oficina]').inner_text(), 'Al elegir «pagaré en la oficina» muestra dónde y cuándo pagar')
        p.check('input[name=consent]'); p.click('button:has-text("Inscribirme y pagar en la oficina")')
        p.wait_for_selector('[data-testid=inscripcion-pendiente]', timeout=20000)
        check('20.000' in p.inner_text('body') and 'oficina' in p.inner_text('body').lower(), 'Pantalla: inscripción reservada, pagar en la oficina con el monto')
        c.close()

        # ================= Revisión en la plataforma =================
        go(o, f'{BASE}/app/inscripciones')
        check(o.locator('[data-testid=contador-por-verificar]').inner_text().strip() == '2', 'Por verificar: 2 inscripciones')
        marta = o.locator('[data-testid=solicitud-inscripcion]', has_text='Marta Comprobante')
        href = marta.locator('[data-testid=ver-comprobante]').get_attribute('href')
        r = o.request.get(f'{BASE}{href}')
        check(r.status == 200 and r.body()[:4] == b'\x89PNG', 'Ver el comprobante adjunto')
        anon = new().request.get(f'{BASE}{href}', max_redirects=0)
        check(anon.status in (302, 307) and '/login' in anon.headers.get('location', ''), 'El comprobante no se puede ver sin iniciar sesión')
        marta.locator('button:has-text("Aprobar inscripción")').click()
        until(lambda: 'quedó inscrito' in o.locator('[role=status]').last.inner_text(), 30, 'aprobada')
        msg = o.locator('[role=status]').last.inner_text()
        check('Se le avisó por correo' in msg, f'Aprobada con aviso por correo ({msg[:120]})')
        row = sql("""select r.source||'|'||(r.form_data->>'shift')||'|'||c.status::text||'|'||p.method::text||'|'||(s.user_id is not null)
                     from registrations r join students s on s.id=r.student_id join charges c on c.student_id=s.id and c.concept='registration_fee'
                     join payments p on p.student_id=s.id where s.email='marta.comp@demo.sematec.test'""")
        check(row == 'web|Noche|paid|bank_transfer|true', f'Queda inscrita como estudiante, pago registrado por transferencia y con cuenta ({row})')
        until(lambda: len(mails('marta.comp@demo.sematec.test')) >= 2, 15, 'correo aprobación')
        subj, body = mails('marta.comp@demo.sematec.test')[-1]
        link = re.search(r'(https?://\S+/auth/confirm\?\S+)', body)
        check('aprobada' in subj and link, 'Correo de aprobación con enlace para crear su contraseña')
        nc = new(); n = nc.new_page(); go(n, link.group(1).replace('https://', 'http://').replace(re.match(r'https?://[^/]+', link.group(1)).group(0), BASE))
        n.wait_for_url(re.compile(r'/cambiar-clave'), timeout=20000)
        n.fill('input[name=password]', 'Inscrita2027Segura'); n.fill('input[name=confirm]', 'Inscrita2027Segura'); n.click('button:has-text("Guardar contraseña")'); status_msg(n)
        nc.close()
        nc = new(); n = nc.new_page(); go(n, f'{BASE}/login'); n.fill('input[name=email]', 'marta.comp@demo.sematec.test'); n.fill('input[name=password]', 'Inscrita2027Segura'); n.click('button[type=submit]')
        n.wait_for_url(re.compile(r'/app'), timeout=20000)
        check(True, 'Con el enlace del correo crea su contraseña y entra a la plataforma')
        nc.close()
        pedro = o.locator('[data-testid=solicitud-inscripcion]', has_text='Pedro Oficina')
        pedro.locator('summary:has-text("Rechazar")').click(); pedro.locator('textarea[name=notes]').fill('No se registró su pago en la oficina antes del plazo.')
        o.once('dialog', lambda d: d.accept()); pedro.locator('button:has-text("Rechazar")').click()
        until(lambda: sql("select status from registration_requests where email='pedro.ofi@demo.sematec.test'") == 'rejected', 15, 'rechazo')
        until(lambda: any('No se registró su pago' in t for _, t in mails('pedro.ofi@demo.sematec.test')), 15, 'correo rechazo')
        check(True, 'Rechazo con motivo, avisado por correo a la persona')
        code = sql("select tracking_code from registration_requests where email='pedro.ofi@demo.sematec.test'")
        c = new(); p = c.new_page(); go(p, f'{BASE}/inscripcion/lista?codigo={code}&correo=pedro.ofi@demo.sematec.test')
        check('no aprobada' in p.inner_text('body').lower() and 'plazo' in p.inner_text('body'), 'La persona ve el estado y el motivo con su código'); c.close()

        # ================= Recuperar contraseña desde el inicio de sesión =================
        rc = new(); r = rc.new_page(); go(r, f'{BASE}/login'); r.click('a:has-text("¿Olvidó su contraseña?")'); r.wait_for_url(re.compile(r'/recuperar'), timeout=15000); r.wait_for_load_state('networkidle')
        r.fill('input[name=email]', 'estudiante2.a@demo.sematec.test'); r.click('button:has-text("Enviar enlace")'); status_msg(r)
        until(lambda: any('/auth/confirm' in t for _, t in mails('estudiante2.a@demo.sematec.test')), 15, 'correo recuperación')
        body = [t for _, t in mails('estudiante2.a@demo.sematec.test') if '/auth/confirm' in t][-1]
        url = re.search(r'(https?://\S+/auth/confirm\?\S+)', body).group(1)
        go(r, re.sub(r'^https?://[^/]+', BASE, url)); r.wait_for_url(re.compile(r'/cambiar-clave'), timeout=20000)
        r.fill('input[name=password]', 'NuevaClave2026Real'); r.fill('input[name=confirm]', 'NuevaClave2026Real'); r.click('button:has-text("Guardar contraseña")'); status_msg(r)
        rc.close()
        lc = new(); l = lc.new_page(); go(l, f'{BASE}/login'); l.fill('input[name=email]', 'estudiante2.a@demo.sematec.test'); l.fill('input[name=password]', 'NuevaClave2026Real'); l.click('button[type=submit]')
        l.wait_for_url(re.compile(r'/app'), timeout=20000)
        check(True, 'Recuperar contraseña desde el inicio: llega el correo, crea la nueva clave y entra con ella'); lc.close()

        # ================= «Enviar también por correo» =================
        go(o, f'{BASE}/app/mensajes'); o.click('summary:has-text("Nuevo mensaje")')
        check(o.locator('[data-testid=enviar-correo] input').is_checked(), 'Mensajes: casilla «Enviar también por correo» marcada')
        opt = o.locator('select[name=recipient_id] option', has_text='rofesor').first
        o.select_option('select[name=recipient_id]', opt.get_attribute('value'))
        to_email = sql(f"select email from profiles where id='{opt.get_attribute('value')}'")
        o.fill('input[name=subject]', 'Reunión de coordinación'); o.fill('textarea[name=body]', 'Nos vemos el lunes a las 10:00.'); o.click('button:has-text("Enviar")')
        check('Enviado por correo a 1' in status_msg(o), 'Mensaje enviado y copia por correo')
        until(lambda: any('Nos vemos el lunes' in t for _, t in mails(to_email)), 15, 'correo mensaje')
        check(True, f'El destinatario recibe el mensaje en su correo ({to_email})')
        go(o, f'{BASE}/app/anuncios'); o.click('summary:has-text("Publicar anuncio")')
        o.fill('input[name=title]', 'Suspensión de clases'); o.fill('textarea[name=body]', 'El viernes no hay clases por jornada de evaluación.')
        o.select_option('select[name=audience]', 'students'); o.click('button:has-text("Publicar")')
        m = status_msg(o); check('Enviado por correo a' in m, f'Anuncio a estudiantes con copia por correo ({m})')
        until(lambda: any('jornada de evaluación' in t for _, t in mails('estudiante1.a@demo.sematec.test')), 15, 'correo anuncio')
        check(True, 'Los estudiantes reciben el anuncio en su correo')
        ec = new(); e = login(ec, 'estudiante1.a@demo.sematec.test')
        go(e, f'{BASE}/app/punto-estudiantil'); e.fill('input[name=subject]', 'Certificado para beca'); e.click('button:has-text("Enviar solicitud")')
        check('Enviado por correo' in status_msg(e), 'Solicitud del estudiante con copia por correo a quien la atiende')
        go(o, f'{BASE}/app/punto-estudiantil'); o.locator('summary:has-text("Responder")').first.click()
        o.locator('textarea[name=response]').first.fill('Su certificado está listo para retirar.'); o.locator('button:has-text("Guardar y notificar")').first.click()
        check('Enviado por correo a 1' in status_msg(o), 'Respuesta al estudiante con copia por correo')
        until(lambda: any('listo para retirar' in t for _, t in mails('estudiante1.a@demo.sematec.test')), 15, 'correo respuesta')

        # ================= Ocultar para estudiantes por 1 semana =================
        go(o, f'{BASE}/app/anuncios')
        art = o.locator('article, li, .card', has_text='Suspensión de clases').filter(has=o.locator('[data-testid=menu-ocultar]')).last
        art.locator('[data-testid=menu-ocultar] summary').click()
        art.locator('[data-testid=ocultar-all]').uncheck(); art.locator('[data-testid=ocultar-students]').check(); art.locator('[data-testid=ocultar-duracion]').select_option('7d')
        art.locator('button:has-text("Ocultar")').click()
        until(lambda: sql("select array_to_string(audience, ',')||'|'||(hidden_until > now() + interval '6 days') from hidden_records where table_name='announcements'") == 'students|true', 15, 'oculto')
        check(True, '«Ocultar para» estudiantes «por» una semana')
        go(e, f'{BASE}/app/anuncios')
        check('Suspensión de clases' not in e.inner_text('body'), 'El estudiante ya no ve el anuncio oculto')
        go(o, f'{BASE}/app/anuncios')
        until(lambda: 'Oculto' in o.locator('[data-testid=menu-ocultar] summary', has_text='Oculto').first.inner_text(), 10, 'marca oculto')
        check(True, 'El propietario lo sigue viendo con la marca «Oculto: Estudiantes»')
        go(o, f'{BASE}/app/papelera')
        check(o.locator('[data-testid=lista-ocultos] tr', has_text='Anuncio').count() == 1, 'Papelera y ocultos: lista lo oculto')
        o.locator('[data-testid=lista-ocultos] button:has-text("Mostrar")').click(); status_msg(o)
        go(e, f'{BASE}/app/anuncios')
        check('Suspensión de clases' in e.inner_text('body'), 'Al mostrarlo de nuevo, el estudiante lo vuelve a ver')

        # ================= Mapa de la plataforma =================
        go(e, f'{BASE}/app/mapa')
        n_est = e.locator('[data-testid=sistema-mapa]').count()
        go(o, f'{BASE}/app/mapa'); n_own = o.locator('[data-testid=sistema-mapa]').count()
        check(n_own > n_est > 3 and o.locator('[data-testid=area-academico]').count() == 1, f'Mapa de la plataforma por áreas según permisos (propietario {n_own}, estudiante {n_est})')
        o.fill('[data-testid=buscar-mapa]', 'notas')
        until(lambda: 0 < o.locator('[data-testid=sistema-mapa]').count() < n_own, 5, 'buscar mapa')
        check(True, 'Buscar en el mapa'); shot(o, 'insc_02_mapa')

        # ================= Registro de correos =================
        go(o, f'{BASE}/app/configuracion?t=institucion#correo')
        txt = o.locator('[data-testid=registro-correos]').inner_text()
        check('marta.comp@demo.sematec.test' in txt and '✓ Enviado' in txt, 'Configuración → Correo: registro de correos enviados')
        o.fill('[data-testid=prueba-correo-a]', 'otra.persona@demo.sematec.test'); o.click('button:has-text("Enviar correo de prueba")')
        check('otra.persona@demo.sematec.test' in status_msg(o), 'Correo de prueba a cualquier dirección')
        until(lambda: mails('otra.persona@demo.sematec.test'), 10, 'prueba')
        b.close()
    ok = sum(1 for r in results if r[0]); print(f'\n{ok}/{len(results)} verificaciones OK')

if __name__ == '__main__':
    main()
