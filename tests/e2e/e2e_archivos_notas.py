"""Recuperar contraseña (correo real por SMTP), identificación en la matrícula, libros asociados, calificaciones,
archivos con historial del propietario y aula virtual: compartir para todos, celular, adjuntos, grabación por partes, cortar y unir."""
import re, sys, os, time, json, glob, email, email.header
sys.path.insert(0, os.path.dirname(__file__))
from e2e import BASE, CHROME, PASS, sql, check, login, status_msg, go as go_idle, results, secrets

def go(page, url):
    page.goto(url); page.wait_for_load_state('load')
from playwright.sync_api import sync_playwright
import pyotp

ORG = '0a000000-0000-4000-8000-000000000001'
SEC = '0a000000-0000-4000-8000-00000000ad01'
T1 = '00000000-0000-4000-8000-000000000020'
MEDIA = '/tmp/media'
os.makedirs('/tmp/mails', exist_ok=True)

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

for f in glob.glob('/tmp/mails/*.eml'): os.remove(f)
sql("delete from user_files where name in ('foto.png','clase2.webm')")
sql("delete from system_events where event_type in ('rate:pwreset_ip','rate:pwreset_email','rate:upload')")
sql("delete from students where student_code = 'EST-RUT'"); sql("delete from applications where applicant_email = 'pasaporte@demo.sematec.test'")
sql("update auth.users set encrypted_password = extensions.crypt('Sematec-Demo-2026', extensions.gen_salt('bf')) where email like '%demo.sematec.test'")
try:
    aid = sql(f"insert into assessments (organization_id, section_id, name, weight_pct, published) values ('{ORG}', '{SEC}', 'Control notas E2E', 5, true) returning id").splitlines()[0]
    sql(f"insert into grades (organization_id, assessment_id, student_id, grade) select '{ORG}', '{aid}', s.id, 5.5 from students s join auth.users u on u.id = s.user_id where u.email = 'estudiante1.a@demo.sematec.test' on conflict do nothing")
except Exception: pass  # ya existe o la sección no admite más ponderación
sql(f"insert into section_enrollments (organization_id, section_id, student_id, enrollment_id) select '{ORG}', '{SEC}', e.student_id, e.id from enrollments e join students s on s.id = e.student_id where s.organization_id = '{ORG}' and s.user_id is not null on conflict do nothing")

with sync_playwright() as pw:
    b = pw.chromium.launch(executable_path=CHROME, headless=True, args=['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream',
                           '--auto-accept-this-tab-capture', '--no-sandbox'])
    new = lambda **kw: b.new_context(viewport={'width': 1366, 'height': 900}, **kw)

    # ================= 1. Recuperar contraseña de verdad =================
    rc = new(); r = rc.new_page(); go(r, BASE + '/login'); r.click('a:has-text("¿Olvidó su contraseña?")')
    r.wait_for_url(re.compile(r'/recuperar')); r.fill('input[name=email]', 'estudiante3.a@demo.sematec.test'); r.click('button:has-text("Enviar enlace")')
    m = status_msg(r); check('recibirá' in m, f'Pide el enlace desde el inicio ({m[:50]})')
    time.sleep(1.5); ms = mails_to('estudiante3.a@demo.sematec.test')
    check(len(ms) == 1 and 'contraseña' in ms[0][0], 'Llega un correo real (SMTP) con el asunto de recuperación')
    lnk = link_in(ms[0][1]); check(bool(lnk), 'El correo trae el enlace para crear la contraseña')
    other = new().new_page(); go(other, lnk)  # se abre en OTRO equipo / navegador
    other.wait_for_url(re.compile(r'/cambiar-clave'), timeout=20000)
    check('estudiante3.a' in other.locator('main, body').first.inner_text(), 'El enlace funciona aunque se abra en otro equipo')
    NEWPW = 'NuevaClaveSegura2026'
    other.fill('input[name=password]', NEWPW); other.fill('input[name=confirm]', NEWPW); other.click('button:has-text("Guardar contraseña")')
    check('actualizada' in status_msg(other), 'Crea la nueva contraseña')
    go(other, lnk); other.wait_for_url(re.compile(r'/(login|cambiar-clave)'), timeout=20000)
    check('/login' in other.url or other.locator('text=Enlace vencido').count() == 1, 'El enlace sirve una sola vez')
    lp = new().new_page(); go(lp, BASE + '/login'); lp.fill('input[name=email]', 'estudiante3.a@demo.sematec.test'); lp.fill('input[name=password]', NEWPW)
    lp.click('button[type=submit]'); lp.wait_for_url(re.compile(r'/app'), timeout=20000); check(True, 'Entra con la nueva contraseña')
    go(r, BASE + '/recuperar'); r.fill('input[name=email]', 'no.existe@demo.sematec.test'); r.click('button:has-text("Enviar enlace")')
    m = status_msg(r); time.sleep(1)
    check('recibirá' in m and not mails_to('no.existe@demo.sematec.test'), 'Correo inexistente: misma respuesta, sin envío (no revela cuentas)')
    # Funcionaria: entra con contraseña y la cambia en «Mi cuenta»
    sc = new(); s = login(sc, 'secretaria.a@demo.sematec.test')
    go(s, BASE + '/app/perfil'); s.fill('input[name=password]', 'SecretariaClave2026'); s.fill('input[name=confirm]', 'SecretariaClave2026')
    s.click('button:has-text("Cambiar contraseña")'); check('actualizada' in status_msg(s), 'Funcionaria cambia su contraseña en «Mi cuenta»')
    sql("update auth.users set encrypted_password = extensions.crypt('Sematec-Demo-2026', extensions.gen_salt('bf')) where email in ('estudiante3.a@demo.sematec.test','secretaria.a@demo.sematec.test')")
    # Propietario con MFA: el enlace pide el código antes de cambiarla
    oc = new(accept_downloads=True); o = login(oc, 'propietario.a@demo.sematec.test', mfa=True)
    go(r, BASE + '/recuperar'); r.fill('input[name=email]', 'propietario.a@demo.sematec.test'); r.click('button:has-text("Enviar enlace")'); status_msg(r); time.sleep(1.5)
    olink = link_in(mails_to('propietario.a@demo.sematec.test')[-1][1])
    op = new().new_page(); go(op, olink); op.wait_for_url(re.compile(r'/mfa\?next=/cambiar-clave'), timeout=20000)
    op.fill('input[inputmode=numeric]', pyotp.TOTP(secrets['propietario.a@demo.sematec.test']).now()); op.click('button:has-text("Verificar")')
    op.wait_for_url(re.compile(r'/cambiar-clave'), timeout=20000); check(True, 'Cuenta con MFA: pide el código y luego deja crear la contraseña')
    go(o, BASE + '/app/ciberseguridad')
    check(o.locator('text=Correo de recuperación de contraseña').count() >= 1, 'Ciberseguridad revisa que el correo de recuperación esté configurado')

    # ================= 2. Identificación en la matrícula =================
    go(o, BASE + '/app/estudiantes'); o.click('summary:has-text("Registrar estudiante")')
    f = o.locator('form:has(input[name=student_code])').first
    check(f.locator('select[name=id_document_type]').count() == 1 and f.locator('input[name=id_document_number]').count() == 1, 'El formulario pide documento de identidad (RUT, pasaporte…)')
    f.locator('input[name=student_code]').fill('EST-RUT'); f.locator('input[name=first_names]').fill('Rut'); f.locator('input[name=last_names]').fill('Prueba')
    f.locator('input[name=email]').fill('rut.prueba@demo.sematec.test'); f.locator('input[name=password]').fill('ClaveSegura2026x')
    f.locator('input[name=id_document_number]').fill('12.345.678-9'); f.locator('button[type=submit]').click()
    m = status_msg(o); check('no es válido' in m, f'RUT con dígito verificador incorrecto: rechazado ({m[:60]})')
    f.locator('input[name=id_document_number]').fill('12345678-5'); f.locator('button[type=submit]').click(); status_msg(o)
    check(sql("select id_document_type || ' ' || id_document_number from students where student_code = 'EST-RUT'") == 'RUN 12.345.678-5', 'RUT válido guardado con formato 12.345.678-5')
    go(o, BASE + '/app/estudiantes?q=12.345.678'); check(o.locator('text=12.345.678-5').count() >= 1, 'Se busca al estudiante por su RUT')
    pub = new().new_page(); slug = sql(f"select slug from catalog_offerings where organization_id = '{ORG}' and is_published and admission_mode = 'application' limit 1")
    go(pub, f'{BASE}/cursos/{slug}/inscripcion')
    if pub.locator('input[name=doc_number]').count():
        pub.fill('input[name=name]', 'Postulante Pasaporte'); pub.fill('input[name=email]', 'pasaporte@demo.sematec.test')
        pub.select_option('select[name=doc_type]', 'PASAPORTE'); pub.fill('input[name=doc_number]', 'AB 123456'); pub.check('input[name=consent]')
        pub.select_option('select[name=doc_type]', 'RUN'); pub.fill('input[name=doc_number]', '11.111.111-2')
        pub.locator('button:has-text("Enviar postulación")').click(); pub.wait_for_selector('text=no es válido', timeout=20000)
        check(True, 'Postulación web: RUT inválido rechazado')
        pub.select_option('select[name=doc_type]', 'PASAPORTE'); pub.fill('input[name=doc_number]', 'AB 123456')
        pub.locator('button:has-text("Enviar postulación")').click(); pub.wait_for_selector('text=Postulación recibida', timeout=20000)
        check(sql("select count(*) from applications where applicant_email = 'pasaporte@demo.sematec.test' and form_data->>'doc_number' = 'AB123456'") == '1',
              'Postulación web con pasaporte: queda guardado el documento')
    else:
        check(False, 'El formulario público pide el documento')

    # ================= 3. Libros asociados =================
    prog = sql(f"select id from programs where organization_id = '{ORG}' order by code limit 1")
    go(o, f'{BASE}/app/biblioteca?carrera={prog}')
    check(o.locator('select[name=carrera]').count() == 1 and o.locator('select[name=seccion]').count() == 1, 'Biblioteca: filtros por carrera, asignatura y curso')
    try:
        sql(f"insert into library_items (organization_id, title, item_type) values ('{ORG}', 'Libro sin asociar', 'libro')"); ok_bad = False
    except Exception: ok_bad = True
    check(ok_bad, 'La base no acepta libros sin carrera, asignatura o curso')

    # ================= 4. Calificaciones =================
    go(o, BASE + '/app/calificaciones')
    check(o.locator('[data-testid=tabla-notas] tbody tr').count() >= 1 and o.locator('[data-testid=promedio-institucion]').inner_text() != '—', 'Calificaciones: promedio por estudiante y de la institución')
    for t, txt in [('asignaturas', 'Aprobando'), ('carreras', 'Carrera'), ('riesgo', 'Estado'), ('detalle', 'Final')]:
        go(o, f'{BASE}/app/calificaciones?t={t}'); check(o.locator(f'[data-testid=tabla-notas] th:has-text("{txt}")').count() >= 1, f'Calificaciones: vista «{t}»')
    with o.expect_download() as dl: o.locator('[data-testid=exportar-notas]').click()
    data = open(dl.value.path(), encoding='utf-8-sig').read(); check('Promedio' in data.splitlines()[0], 'Calificaciones a Excel')
    ec = new(); e = login(ec, 'estudiante1.a@demo.sematec.test')
    go(e, BASE + '/app/calificaciones')
    check(e.locator('[data-testid=promedio-general]').inner_text() not in ('', '—') and e.locator('text=Ponderación').count() >= 1, 'Estudiante: sus notas, promedio por asignatura y promedio general')

    # ================= 5. Archivos con historial =================
    go(e, BASE + '/app/archivos')
    up = e.locator('[data-testid=subir-archivos]')
    up.locator('input[type=file]').set_input_files([f'{MEDIA}/foto.png', f'{MEDIA}/clase2.webm'])
    up.locator('select[name=visibility]').select_option('section'); up.locator('select[name=section]').select_option(SEC)
    up.locator('input[name=description]').fill('Tarea fotografiada')
    up.locator('button:has-text("Subir archivos")').click()
    e.wait_for_selector('text=✓ «clase2.webm» guardado', timeout=60000)
    check(sql("select count(*) from user_files where name in ('foto.png','clase2.webm') and visibility = 'section' and deleted_at is null") == '2', 'Estudiante sube foto y video para su curso')
    go(e, BASE + '/app/archivos'); check(e.locator('[data-testid=archivo] img').count() >= 1 and e.locator('[data-testid=archivo] video').count() >= 1, 'Vista previa de foto y video')
    up = e.locator('[data-testid=subir-archivos]'); up.locator('input[type=file]').set_input_files(f'{MEDIA}/virus.exe'); up.locator('button:has-text("Subir archivos")').click()
    e.wait_for_selector('text=no permitido', timeout=20000); check(True, 'Archivos peligrosos (ejecutables) se rechazan')
    tc = new(); t = login(tc, 'profesor1.a@demo.sematec.test')
    go(t, BASE + '/app/archivos?t=compartidos'); check(t.locator('[data-testid=archivo]:has-text("foto.png")').count() >= 1, 'El profesor del curso ve lo que subió el estudiante')
    xc = new(); x = login(xc, 'estudiante1.b@demo.sematec.test'); go(x, BASE + '/app/archivos?t=compartidos')
    check(x.locator('text=foto.png').count() == 0, 'Otra institución no ve los archivos')
    fid = sql("select id from user_files where name = 'foto.png' order by created_at desc limit 1")
    go(e, BASE + '/app/archivos'); e.once('dialog', lambda d: d.accept())
    e.locator('[data-testid=archivo]:has-text("foto.png") button:has-text("Eliminar")').first.click()
    for _ in range(40):
        if sql(f"select deleted_at is not null from user_files where id = '{fid}'") == 't': break
        time.sleep(0.5)
    go(e, BASE + '/app/archivos'); check(e.locator('[data-testid=archivo]:has-text("foto.png")').count() == 0, 'El estudiante elimina su archivo y deja de verlo')
    go(t, BASE + '/app/archivos?t=compartidos'); check(t.locator('[data-testid=archivo]:has-text("foto.png")').count() == 0, 'Tampoco lo ven los demás')
    go(o, BASE + '/app/archivos?t=eliminados')
    card = o.locator('[data-testid=archivo]:has-text("foto.png")').first
    check(card.count() == 1 and 'Eliminado' in card.inner_text(), 'El propietario ve el historial de eliminados (quién y cuándo)')
    card.locator('button:has-text("Restaurar")').click(); status_msg(o)
    check(sql(f"select deleted_at is null from user_files where id = '{fid}'") == 't', 'El propietario restaura el archivo')
    as_e = sql("select id from auth.users where email = 'estudiante1.a@demo.sematec.test'")
    sql(f"begin; set local role authenticated; set local request.jwt.claims = '{{\"sub\":\"{as_e}\",\"role\":\"authenticated\"}}'; select delete_user_file('{fid}'); commit;")
    path = sql(f"select storage_path from user_files where id = '{fid}'")
    go(o, BASE + '/app/archivos?t=eliminados'); o.once('dialog', lambda d: d.accept())
    o.locator('[data-testid=archivo]:has-text("foto.png") button:has-text("Eliminar definitivamente")').first.click()
    for _ in range(40):
        if sql(f"select count(*) from user_files where id = '{fid}'") == '0': break
        time.sleep(0.5)
    check(sql(f"select count(*) from user_files where id = '{fid}'") == '0' and not os.path.exists(f'/tmp/storage/user-files/{path}'), 'Eliminar definitivamente borra el registro y el archivo')
    check(sql(f"select count(*) from audit_events where table_name = 'user_files' and record_id = '{fid}' and operation = 'DELETE'") == '1', 'La eliminación definitiva queda en la Auditoría')

    # ================= 6. Aula virtual =================
    room = sql(f"insert into conference_rooms (organization_id, name, room_type, section_id, max_participants, created_by) values ('{ORG}', 'Aula Archivos E2E', 'class', '{SEC}', 50, '{T1}') returning id").splitlines()[0]
    sess = sql(f"""set request.jwt.claims = '{{"sub":"{T1}","role":"authenticated"}}'; select create_conference_session('{room}', 'Clase grabada E2E', 'class', now() - interval '5 minutes', now() + interval '55 minutes', 'America/Santiago', true, null)""").splitlines()[-1]
    check(sql(f"select students_can_share from conference_sessions where id = '{sess}'") == 't', 'Las sesiones nuevas permiten compartir pantalla a todos')
    go(t, f'{BASE}/app/conferencias/sala/{sess}'); t.click('button:has-text("Entrar a la sala")'); t.wait_for_selector('.lk-video-conference', timeout=30000)
    mc = b.new_context(viewport={'width': 390, 'height': 844}, is_mobile=True, has_touch=True,
                       user_agent='Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1')
    mc.add_init_script("try { Object.defineProperty(MediaDevices.prototype, 'getDisplayMedia', { value: undefined, configurable: true }); delete MediaDevices.prototype.getDisplayMedia; } catch (e) {}")
    mob = login(mc, 'estudiante2.a@demo.sematec.test')
    go(mob, f'{BASE}/app/conferencias/sala/{sess}'); mob.click('button:has-text("Entrar a la sala")'); mob.wait_for_selector('.lk-video-conference', timeout=30000)
    mob.locator('[data-testid=compartir-celular]').click()
    check(mob.locator('[data-testid=ayuda-compartir]').count() == 1 and mob.locator('button:has-text("Mostrar con la cámara trasera")').count() == 1, 'Celular: «Compartir pantalla» ofrece cámara trasera y enviar archivos')
    check(mob.locator('button:has-text("Cámara")').count() >= 2, 'Celular: botón 🔄 para cambiar a la cámara trasera')
    mob.locator('button:has-text("Enviar foto, video o archivo al chat")').click()
    mob.locator('[data-testid=adjuntar-chat]').set_input_files(f'{MEDIA}/foto.png')
    t.click('footer button:has-text("Chat")')
    t.wait_for_selector('[data-testid=chat-mensajes] a:has-text("📎 foto.png")', timeout=30000)
    check(True, 'Celular envía una foto al chat y el profesor la recibe como enlace')
    # Grabación guardada en tiempo real (partes de 6 s en la prueba)
    t.evaluate("window.__sematecSegmentMs = 6000")
    t.locator('footer button:has-text("Grabar")').click()
    t.wait_for_selector('[data-testid=detener-grabacion]', timeout=20000); time.sleep(15)
    saved_live = int(sql(f"select count(*) from conference_recordings where session_id = '{sess}' and group_id is not null"))
    check(saved_live >= 1, f'Mientras graba, las partes ya se guardan en la plataforma ({saved_live})')
    t.locator('[data-testid=detener-grabacion]').click()
    t.wait_for_selector('[data-testid=grabacion-lista] a:has-text("Unir, cortar")', timeout=60000)
    n_parts = int(sql(f"select count(*) from conference_recordings where session_id = '{sess}' and group_id is not null"))
    check(n_parts >= 2 and sql(f"select count(distinct group_id) from conference_recordings where session_id = '{sess}'") == '1', f'Clase guardada en {n_parts} partes del mismo grupo')
    # Editor: unir partes y cortar (FFmpeg en el navegador)
    first = sql(f"select id from conference_recordings where session_id = '{sess}' order by part_no limit 1")
    ed = t.context.new_page(); go(ed, f'{BASE}/app/conferencias/grabacion/{first}/editar')
    ed.locator('button:has-text("Unir las")').click()
    ed.wait_for_selector('[data-testid=resultado-video]', timeout=180000)
    check('Se unieron' in ed.locator('[role=status]').last.inner_text(), 'Une las partes en un solo video (FFmpeg en el navegador)')
    ed.locator('button:has-text("Guardar como nueva grabación")').click()
    ed.wait_for_selector('text=Guardado como nueva grabación', timeout=60000)
    check(sql(f"select count(*) from conference_recordings where session_id = '{sess}' and source_id = '{first}'") == '1', 'La clase completa se guarda como nueva grabación')
    # Cortar un video real
    full = sql(f"select id from conference_recordings where session_id = '{sess}' and source_id = '{first}'")
    go(ed, f'{BASE}/app/conferencias/grabacion/{full}/editar')
    ed.fill('[data-testid=corte-desde]', '0:02'); ed.fill('[data-testid=corte-hasta]', '0:06'); ed.locator('button:has-text("Cortar")').click()
    ed.wait_for_selector('[data-testid=resultado-video]', timeout=180000)
    check('Recorte listo' in ed.locator('[role=status]').last.inner_text(), '✂ Corta un tramo del video')
    # Permisos: el estudiante solo ve
    go(e, f'{BASE}/app/conferencias/{sess}')
    check(e.locator('[data-testid=grabacion]').count() >= 2 and e.locator('[data-testid=grabacion] a:has-text("Descargar")').count() == 0
          and e.locator('[data-testid=grabacion] a:has-text("Cortar")').count() == 0 and e.locator('[data-testid=grabacion] button:has-text("Enviar")').count() == 0,
          'Estudiante: solo «Ver» (sin descargar, enviar ni cortar)')
    go(e, f'{BASE}/app/conferencias/grabacion/{first}/editar'); check('/ver' in e.url, 'El estudiante no entra al editor')
    check(e.locator('[data-testid=video-protegido]').get_attribute('controlslist') == 'nodownload', 'Reproductor sin botón de descarga para el estudiante')
    r = e.request.get(f'{BASE}/app/conferencias/grabacion/{first}?descargar=1', max_redirects=0); check(r.status == 403, 'Descarga bloqueada en el servidor para el estudiante')
    r = e.request.post(f'{BASE}/api/grabaciones/subir', data=json.dumps({'session': sess, 'size': 10, 'mime': 'video/webm', 'source': first}), headers={'Content-Type': 'application/json'})
    check(r.status == 403, 'El estudiante no puede guardar recortes')
    go(o, f'{BASE}/app/conferencias/{sess}')
    check(o.locator('[data-testid=grabacion] a:has-text("Descargar")').count() >= 1, 'El propietario está autorizado (descargar, enviar, cortar)')
    b.close()

print(f"\n{sum(1 for r in results if r[0])}/{len(results)} verificaciones OK")
