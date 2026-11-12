"""
Plataforma más grande:
 · Inscripción general (sitio con pago en línea, sin costo, y en caja) → estudiante listo para matricular
 · SEMATEC Oficina: documento (Word), hoja de cálculo (Excel), presentación (PowerPoint), publicación (Publisher),
   exportar a varios formatos, guardar en Mis archivos e importar archivos de Office
 · Descargar archivos y videos en varios formatos (DOCX→PDF, MP4→MP3…)
 · Aula estilo Zoom con panel de Evaluación y calificación; pestaña «Evaluación y calificación» del curso
"""
import io, os, re, subprocess, sys, tempfile, time, zipfile
sys.path.insert(0, os.path.dirname(__file__))
from e2e import BASE, CHROME, sql, check, shot, login, go, status_msg, results
from playwright.sync_api import sync_playwright

ORG = '0a000000-0000-4000-8000-000000000001'
SEC = '0a000000-0000-4000-8000-00000000ad01'
T1 = '00000000-0000-4000-8000-000000000020'

def until(fn, timeout=20, msg=''):
    end = time.time() + timeout
    while time.time() < end:
        try:
            if fn(): return True
        except Exception: pass
        time.sleep(0.4)
    raise AssertionError(f'Tiempo agotado: {msg}')

def download(page, click, timeout=90000):
    with page.expect_download(timeout=timeout) as d:
        click()
    path = d.value.path()
    return d.value.suggested_filename, open(path, 'rb').read()

def pay_mock(p):
    p.wait_for_selector('#provider', timeout=20000); p.click('#approve')
    p.wait_for_url(re.compile(r'/pago/resultado/'), timeout=30000); p.wait_for_load_state('networkidle')

def main():
    tmp = tempfile.mkdtemp()
    with sync_playwright() as pw:
        b = pw.chromium.launch(executable_path=CHROME, headless=True, args=['--no-sandbox', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'])
        new = lambda **k: b.new_context(viewport=k.get('viewport', {'width': 1440, 'height': 900}), accept_downloads=True, permissions=['camera', 'microphone', 'clipboard-read', 'clipboard-write'])

        # ============ 1. Inscripción general ============
        oc = new(); o = login(oc, 'propietario.a@demo.sematec.test', mfa=True)
        go(o, f'{BASE}/app/inscripciones')
        o.check('[data-testid=inscripcion-activa]'); o.fill('input[name=fee]', '15000'); o.fill('input[name=title]', 'Inscripción 2027')
        o.click('button:has-text("Guardar")')
        check('15.000' in status_msg(o), 'Propietario activa la inscripción en línea con monto de $15.000')
        c = new(); p = c.new_page(); go(p, BASE + '/')
        check(p.locator('[data-testid=cta-inscripcion]').count() == 1 and p.locator('header a[href="/inscripcion"]').count() >= 1, 'El sitio muestra «Inscríbete ahora» y el enlace Inscripción en el menú')
        go(p, f'{BASE}/inscripcion')
        check('15.000' in p.locator('[data-testid=monto-inscripcion]').inner_text(), 'Formulario de inscripción con el monto a pagar')
        p.select_option('[data-testid=elegir-programa]', index=1); p.fill('input[name=name]', 'Rosa Inscrita Web'); p.fill('input[name=email]', 'rosa.web@demo.sematec.test'); p.fill('input[name=doc_number]', '18.181.818-2')
        p.fill('input[name=birth_date]', '2001-05-04'); p.fill('input[name=address]', 'Av. Siempre Viva 123'); p.fill('input[name=city]', 'Santiago'); p.fill('input[name=education]', 'Enseñanza media')
        p.check('input[name=provider][value=webpay]'); p.check('input[name=consent]'); shot(p, 'grande_01_inscripcion')
        p.click('button:has-text("Pagar")')
        pay_mock(p)
        p.wait_for_selector('[data-testid=inscripcion-registrada]', timeout=20000)
        check(True, 'Pago aprobado: «Tu inscripción quedó registrada»')
        row = sql("""select r.source||'|'||r.amount::int||'|'||(s.student_code like 'WEB-%')::text||'|'||(s.birth_date::text)||'|'||(r.form_data->>'city')
                     from registrations r join students s on s.id=r.student_id where s.email='rosa.web@demo.sematec.test'""")
        check(row == 'web|15000|true|2001-05-04|Santiago', f'Estudiante creado con sus datos y la inscripción pagada ({row})')
        ch = sql("select concept||':'||gross_amount::int||':'||c.status::text from charges c join students s on s.id=c.student_id where s.email='rosa.web@demo.sematec.test'")
        check(ch == 'registration_fee:15000:paid', f'Cargo de inscripción pagado en su cuenta ({ch})')
        check(sql("select count(*) from enrollments e join students s on s.id=e.student_id where s.email='rosa.web@demo.sematec.test'") == '0', 'Aún sin matrícula: queda listo para matricular')
        check(sql("select count(*) from memberships m join profiles p on p.id=m.user_id where p.email='rosa.web@demo.sematec.test' and m.status='active'") == '1', 'Se creó su cuenta de estudiante en la plataforma')
        c.close()
        # sin costo
        go(o, f'{BASE}/app/inscripciones'); o.fill('input[name=fee]', '0'); o.click('button:has-text("Guardar")'); status_msg(o)
        c = new(); p = c.new_page(); go(p, f'{BASE}/inscripcion')
        p.select_option('[data-testid=elegir-programa]', index=1); p.fill('input[name=name]', 'Tomás Gratis'); p.fill('input[name=email]', 'tomas.gratis@demo.sematec.test'); p.fill('input[name=doc_number]', '19.191.919-K')
        p.check('input[name=consent]'); p.click('button:has-text("Enviar inscripción")')
        p.wait_for_selector('[data-testid=inscripcion-recibida]', timeout=20000)
        check(sql("select source||'|'||amount::int from registrations r join students s on s.id=r.student_id where s.email='tomas.gratis@demo.sematec.test'") == 'web|0', 'Inscripción sin costo: registrado al instante')
        c.close()
        # interna (caja)
        go(o, f'{BASE}/app/inscripciones')
        o.fill('input[name=first_names]', 'Carla'); o.fill('input[name=last_names]', 'Caja Interna'); o.fill('input[name=id_document_number]', '20.202.020-8')
        o.fill('input[name=email]', 'carla.caja@demo.sematec.test'); o.fill('input[name=amount]', '12000'); o.select_option('select[name=method]', 'cash')
        o.click('button:has-text("Inscribir")')
        msg = status_msg(o)
        check('quedó inscrito' in msg and 'pago registrado' in msg, f'Inscripción en caja con el monto pagado ({msg[:80]})')
        pay = sql("select y.method||':'||y.amount::int from payments y join students s on s.id=y.student_id where s.email='carla.caja@demo.sematec.test'")
        check(pay == 'cash:12000', f'Pago de la inscripción registrado en efectivo ({pay})')
        go(o, f'{BASE}/app/inscripciones')
        check(o.locator('[data-testid=lista-inscripciones] tr:has-text("Caja Interna") [data-testid=matricular]').count() == 1, 'Lista de inscritos con botón «Matricular →»')
        shot(o, 'grande_02_inscripciones')
        o.locator('[data-testid=lista-inscripciones] tr:has-text("Caja Interna") [data-testid=matricular]').click()
        o.wait_for_url(re.compile(r'/app/matriculas\?estudiante='), timeout=20000)
        sid = sql("select id from students where email='carla.caja@demo.sematec.test'")
        check(o.input_value('select[name=student_id]') == sid, 'Matricular abre con el estudiante ya elegido')

        # ============ 2. SEMATEC Oficina ============
        go(o, f'{BASE}/app/oficina')
        check(all(o.locator(f'[data-testid=app-{k}]').count() == 1 for k in ['doc', 'sheet', 'slides', 'pub']), 'Oficina: Documento, Hoja de cálculo, Presentación y Publicación')
        shot(o, 'grande_03_oficina')
        # --- Documento
        o.click('[data-testid=nuevo-doc-blanco]'); o.wait_for_url(re.compile(r'/app/oficina/[0-9a-f-]{36}$'), timeout=20000)
        doc_id = o.url.rsplit('/', 1)[1]
        o.wait_for_selector('.ProseMirror', timeout=30000)
        o.fill('[data-testid=titulo-documento]', 'Informe E2E')
        o.click('.ProseMirror'); o.keyboard.type('Hola mundo SEMATEC', delay=15)
        o.keyboard.press('Control+a'); o.click('[data-testid=negrita]'); time.sleep(0.4)
        o.keyboard.press('ArrowRight'); time.sleep(0.3); o.keyboard.press('Enter'); time.sleep(0.3); o.keyboard.type('Segundo párrafo con ñ y acentos áéíóú.', delay=10)
        until(lambda: o.locator('[data-testid=estado-guardado]').inner_text().startswith('✓'), 15, 'guardado')
        content = sql(f"select title||'|'||(content->>'html') from office_documents where id='{doc_id}'")
        check(content.startswith('Informe E2E|') and '<strong>Hola mundo SEMATEC</strong>' in content, 'Documento: texto y negrita guardados automáticamente')
        o.reload(); o.wait_for_selector('.ProseMirror strong', timeout=30000)
        check('Hola mundo' in o.locator('.ProseMirror').inner_text(), 'Al volver a abrir, el documento conserva su contenido')
        shot(o, 'grande_04_documento')
        o.click('[data-testid=oficina-descargar]'); name, data = download(o, lambda: o.click('[data-testid=exportar-docx]'))
        z = zipfile.ZipFile(io.BytesIO(data)); xml = z.read('word/document.xml').decode()
        check(name == 'Informe E2E.docx' and 'Hola mundo SEMATEC' in xml and '<w:b/>' in xml, 'Exporta a Word (.docx) con el texto y la negrita')
        open(os.path.join(tmp, 'Informe E2E.docx'), 'wb').write(data)
        o.click('[data-testid=oficina-descargar]'); name, data = download(o, lambda: o.click('[data-testid=exportar-pdf]'))
        check(data[:4] == b'%PDF', 'Exporta a PDF')
        o.click('[data-testid=oficina-descargar]'); name, data = download(o, lambda: o.click('[data-testid=exportar-odt]'))
        check(zipfile.ZipFile(io.BytesIO(data)).read('mimetype') == b'application/vnd.oasis.opendocument.text', 'Exporta a OpenDocument (.odt)')
        o.click('[data-testid=oficina-descargar]'); name, data = download(o, lambda: o.click('[data-testid=exportar-txt]'))
        check('Segundo párrafo con ñ' in data.decode('utf-8-sig'), 'Exporta a texto (.txt) con acentos y ñ')
        o.click('[data-testid=oficina-descargar]'); o.click('[data-testid=guardar-en-archivos]')
        until(lambda: 'Copia guardada' in o.locator('[data-testid=oficina-aviso]').inner_text(), 30, 'copia en mis archivos')
        check(sql("select count(*) from user_files where name='Informe E2E.docx' and deleted_at is null") == '1', 'Guarda una copia .docx en Mis archivos')
        # --- Hoja de cálculo
        go(o, f'{BASE}/app/oficina'); o.click('[data-testid=nuevo-sheet-blanco]'); o.wait_for_url(re.compile(r'/app/oficina/[0-9a-f-]{36}$'), timeout=20000)
        o.wait_for_selector('[data-testid=grilla]', timeout=30000)
        o.click('[data-cell=A1]')
        for v in ['10', '20', '30', '=SUMA(A1:A3)']:
            o.keyboard.type(v, delay=40); o.keyboard.press('Enter')
        o.click('[data-cell=B1]'); o.keyboard.type('=SI(A1>5;"alto";"bajo")', delay=25); o.keyboard.press('Enter')
        until(lambda: o.locator('[data-cell=A4]').inner_text() == '60', 15, 'suma')
        check(True, 'Hoja de cálculo: =SUMA(A1:A3) da 60')
        check(o.locator('[data-cell=B1]').inner_text() == 'alto', 'Fórmulas en español: =SI(…) funciona')
        o.click('[data-cell=A1]'); o.keyboard.down('Shift'); o.keyboard.press('ArrowDown'); o.keyboard.press('ArrowDown'); o.keyboard.up('Shift')
        check('Suma: 60' in o.locator('[data-testid=resumen-seleccion]').inner_text(), 'Barra de estado con suma y promedio de la selección')
        o.click('[data-testid=boton-grafico]'); check(o.locator('[data-testid=grafico] svg rect').count() >= 3, 'Gráfico de barras de la selección')
        until(lambda: o.locator('[data-testid=estado-guardado]').inner_text().startswith('✓'), 15, 'guardado hoja')
        shot(o, 'grande_05_hoja')
        o.click('[data-testid=oficina-descargar]'); name, data = download(o, lambda: o.click('[data-testid=exportar-xlsx]'))
        sx = zipfile.ZipFile(io.BytesIO(data)).read('xl/worksheets/sheet1.xml').decode()
        check('<f>SUM(A1:A3)</f>' in sx and '<v>60</v>' in sx, 'Exporta a Excel (.xlsx) con fórmulas y resultados')
        open(os.path.join(tmp, 'Datos.xlsx'), 'wb').write(data)
        o.click('[data-testid=oficina-descargar]'); name, data = download(o, lambda: o.click('[data-testid=exportar-csv]'))
        check('60' in data.decode('utf-8-sig') and 'alto' in data.decode('utf-8-sig'), 'Exporta a CSV')
        o.click('[data-testid=oficina-descargar]'); name, data = download(o, lambda: o.click('[data-testid=exportar-ods]'))
        check(zipfile.ZipFile(io.BytesIO(data)).read('mimetype') == b'application/vnd.oasis.opendocument.spreadsheet', 'Exporta a OpenDocument (.ods)')
        # plantilla de notas
        go(o, f'{BASE}/app/oficina'); o.click('[data-testid=nuevo-sheet-notas]'); o.wait_for_selector('[data-cell=E2]', timeout=30000)
        until(lambda: o.locator('[data-cell=E2]').inner_text() == '6,2', 15, 'promedio plantilla')
        check(o.locator('[data-cell=F2]').inner_text() == 'Aprobado', 'Plantilla «Planilla de notas» calcula promedios y situación')
        # --- Presentación
        go(o, f'{BASE}/app/oficina'); o.click('[data-testid=nuevo-slides-azul]'); o.wait_for_selector('[data-testid=lienzo]', timeout=30000)
        check(o.locator('[data-testid=miniaturas] > div').count() == 2, 'Presentación con tema: portada y diapositiva de contenido')
        o.click('[data-testid=nueva-diapositiva]'); o.click('button:has-text("Dos columnas")')
        o.click('[data-testid=insertar-texto]'); o.click('summary:has-text("Formas")'); o.click('[data-testid=forma-star]')
        check(o.locator('[data-testid=miniaturas] > div').count() == 3, 'Agregar diapositivas, textos y formas')
        until(lambda: o.locator('[data-testid=estado-guardado]').inner_text().startswith('✓'), 15, 'guardado ppt')
        shot(o, 'grande_06_presentacion')
        o.click('[data-testid=oficina-descargar]'); name, data = download(o, lambda: o.click('[data-testid=exportar-pptx]'))
        zp = zipfile.ZipFile(io.BytesIO(data))
        check(name.endswith('.pptx') and 'ppt/slides/slide3.xml' in zp.namelist(), 'Exporta a PowerPoint (.pptx) con sus 3 diapositivas')
        open(os.path.join(tmp, 'Clase.pptx'), 'wb').write(data)
        o.click('[data-testid=oficina-descargar]'); name, data = download(o, lambda: o.click('[data-testid=exportar-pdf]'))
        check(data[:4] == b'%PDF', 'Presentación a PDF')
        o.click('[data-testid=presentar]'); o.wait_for_selector('[data-testid=modo-presentacion]', timeout=10000)
        o.keyboard.press('ArrowRight'); check('2 / 3' in o.locator('[data-testid=modo-presentacion]').inner_text(), 'Modo presentación a pantalla completa (flechas)')
        o.keyboard.press('Escape')
        # --- Publicación
        go(o, f'{BASE}/app/oficina'); o.click('[data-testid=nuevo-pub-afiche]'); o.wait_for_selector('[data-testid=lienzo]', timeout=30000)
        o.click('[data-testid=oficina-descargar]'); name, data = download(o, lambda: o.click('[data-testid=exportar-png]'))
        check(data[:8] == b'\x89PNG\r\n\x1a\n', 'Publicación (afiche) a imagen PNG')
        shot(o, 'grande_07_publicacion')
        # --- Importar archivos de Office
        for fn, sel, txt in [('Informe E2E.docx', '.ProseMirror', 'Hola mundo SEMATEC'), ('Datos.xlsx', '[data-cell=A4]', '60'), ('Clase.pptx', '[data-testid=lienzo]', 'Título de la presentación')]:
            go(o, f'{BASE}/app/oficina'); o.set_input_files('[data-testid=importar-oficina]', os.path.join(tmp, fn))
            o.wait_for_url(re.compile(r'/app/oficina/[0-9a-f-]{36}$'), timeout=30000); o.wait_for_selector(sel, timeout=30000)
            until(lambda: txt in o.locator(sel).first.inner_text(), 15, f'importar {fn}')
            check(True, f'Abre «{fn}» en SEMATEC Oficina para editarlo')

        # ============ 3. Descargar en varios formatos ============
        mp4 = os.path.join(tmp, 'clase-corta.mp4')
        subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc=size=320x240:rate=15', '-f', 'lavfi', '-i', 'sine=frequency=440', '-t', '2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', mp4], check=True)
        go(o, f'{BASE}/app/archivos')
        o.set_input_files('[data-testid=subir-archivos] input[type=file]', [mp4])
        o.click('button:has-text("Subir archivos")'); o.wait_for_selector('[data-testid=subir-archivos] [role=status] li', timeout=60000)
        up = o.locator('[data-testid=subir-archivos] [role=status]').inner_text(); print('subida:', up)
        until(lambda: sql("select count(*) from user_files where name='clase-corta.mp4'") == '1', 30, f'subida del video ({up})')
        go(o, f'{BASE}/app/archivos')
        card = o.locator('[data-testid=archivo]:has-text("clase-corta.mp4")').first
        card.locator('[data-testid=descargar-como]').click()
        check(card.locator('[data-testid=formato-mp3]').count() == 1 and card.locator('[data-testid=formato-webm]').count() == 1 and card.locator('[data-testid=formato-gif]').count() == 1,
              'Video: descargar como MP4, WebM, MKV, MOV, AVI, GIF, MP3, M4A, WAV, OGG')
        shot(o, 'grande_08_formatos_video')
        name, data = download(o, lambda: card.locator('[data-testid=formato-mp3]').click(), timeout=180000)
        check(name == 'clase-corta.mp3' and (data[:3] == b'ID3' or data[:2] == b'\xff\xfb'), 'Video convertido a MP3 (solo audio) en el navegador')
        doccard = o.locator('[data-testid=archivo]:has-text("Informe E2E.docx")').first
        doccard.locator('[data-testid=descargar-como]').click()
        name, data = download(o, lambda: doccard.locator('[data-testid=formato-pdf]').click(), timeout=60000)
        check(name == 'Informe E2E.pdf' and data[:4] == b'%PDF', 'Documento Word descargado como PDF')
        doccard.locator('[data-testid=descargar-como]').click(); doccard.locator('a:has-text("Abrir y editar en SEMATEC Oficina")').click()
        o.wait_for_url(re.compile(r'/app/oficina/[0-9a-f-]{36}$'), timeout=30000); o.wait_for_selector('.ProseMirror', timeout=30000)
        check('Hola mundo' in o.locator('.ProseMirror').inner_text(), 'Desde Mis archivos: «Abrir y editar en SEMATEC Oficina»')
        oc.close()

        # ============ 4. Aula estilo Zoom + Evaluación y calificación ============
        sql(f"insert into section_enrollments (organization_id, section_id, student_id, enrollment_id) select '{ORG}', '{SEC}', e.student_id, e.id from enrollments e join students s on s.id = e.student_id where s.organization_id = '{ORG}' and s.user_id is not null on conflict do nothing")
        room = sql(f"insert into conference_rooms (organization_id, name, room_type, section_id, max_participants, created_by) values ('{ORG}', 'Aula Evaluación E2E', 'class', '{SEC}', 50, '{T1}') returning id").splitlines()[0]
        sess = sql(f"""set request.jwt.claims = '{{"sub":"{T1}","role":"authenticated"}}'; select create_conference_session('{room}', 'Clase con evaluación', 'class', now() - interval '5 minutes', now() + interval '55 minutes', 'America/Santiago', true, null)""").splitlines()[-1]
        qid = sql(f"insert into quizzes (organization_id, section_id, title, opens_at, closes_at, published) values ('{ORG}', '{SEC}', 'Control relámpago E2E', now() - interval '1 minute', now() + interval '1 hour', true) returning id").splitlines()[0]
        tc = new(); t = login(tc, 'profesor1.a@demo.sematec.test')
        go(t, f'{BASE}/app/conferencias/sala/{sess}'); t.click('button:has-text("Entrar a la sala")'); t.wait_for_selector('.lk-video-conference', timeout=30000)
        for sel in ['boton-microfono', 'boton-camara', 'boton-participantes', 'boton-chat', 'boton-reacciones', 'boton-evaluacion', 'boton-mas-escritorio', 'boton-salir']:
            check(t.locator(f'[data-testid=barra-controles] [data-testid={sel}]').count() >= 1, f'Barra inferior estilo Zoom: {sel.replace("boton-", "")}')
        ec = new(); e = login(ec, 'estudiante1.a@demo.sematec.test')
        go(e, f'{BASE}/app/conferencias/sala/{sess}'); e.click('button:has-text("Entrar a la sala")'); e.wait_for_selector('.lk-video-conference', timeout=30000)
        until(lambda: t.locator('.lk-participant-tile').count() >= 2, 30, 'dos participantes')
        t.click('[data-testid=boton-evaluacion]'); t.wait_for_selector('[data-testid=panel-evaluacion]', timeout=15000)
        t.wait_for_selector('[data-testid=eval-tab-calificar]', timeout=15000)
        if not t.locator('[data-testid=eval-nueva-nombre]').is_visible(): t.click('[data-testid=panel-evaluacion] summary:has-text("Nueva evaluación")')
        t.fill('[data-testid=eval-nueva-nombre]', 'Participación en clase E2E'); t.click('[data-testid=eval-crear]')
        until(lambda: 'Participación en clase E2E' in t.locator('[data-testid=eval-evaluacion]').inner_text(), 15, 'evaluación creada')
        until(lambda: t.locator('[data-testid=eval-nota]').count() >= 1, 20, 'estudiante conectado en la lista')
        t.locator('[data-testid=eval-nota]').first.fill('6,5'); t.click('[data-testid=eval-guardar]')
        until(lambda: sql("select g.grade::text from grades g join assessments a on a.id=g.assessment_id join students s on s.id=g.student_id join auth.users u on u.id=s.user_id where a.name='Participación en clase E2E' and u.email='estudiante1.a@demo.sematec.test'") in ('6.50', '6.5'), 15, 'nota guardada')
        check(True, '📝 El profesor califica a los estudiantes conectados sin salir de la clase')
        shot(t, 'grande_09_aula_evaluacion')
        t.click('[data-testid=eval-tab-lanzar]'); t.locator('div:has-text("Control relámpago E2E") > [data-testid=lanzar-evaluacion]').first.click()
        e.wait_for_selector('[data-testid=evaluacion-lanzada]', timeout=15000)
        href = e.locator('[data-testid=rendir-ahora]').get_attribute('href')
        check(href == f'/app/aula/{SEC}/examen/{qid}/rendir', '📣 El estudiante recibe la evaluación con «Rendir ahora»')
        shot(e, 'grande_10_aula_estudiante')
        e.click('button:has-text("Más tarde")'); e.click('[data-testid=boton-evaluacion]'); e.wait_for_selector('[data-testid=mi-promedio]', timeout=15000)
        check('6,5' in e.locator('[data-testid=panel-evaluacion]').inner_text(), 'El estudiante ve sus notas y promedio en la clase')
        go(t, f'{BASE}/app/aula/{SEC}?t=evaluacion'); t.wait_for_selector('[data-testid=libro-notas]', timeout=20000)
        check(t.locator('[data-testid=libro-notas] th:has-text("Participación en clase E2E")').count() == 1, 'Pestaña «Evaluación y calificación» del curso con el libro de notas')
        go(e, f'{BASE}/app/aula/{SEC}?t=evaluacion'); e.wait_for_selector('[data-testid=mi-promedio-aula]', timeout=20000)
        check(e.locator('text=Participación en clase E2E').count() >= 1, 'El estudiante ve sus notas en el curso')
        tc.close(); ec.close(); b.close()

if __name__ == '__main__':
    try: main()
    finally:
        ok = sum(1 for r in results if r[0]); print(f'\n{ok}/{len(results)} verificaciones OK')
