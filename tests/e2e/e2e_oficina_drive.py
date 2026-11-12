"""
SEMATEC Oficina 2024 (requisitos ampliados): Drive y escenarios E2E-01..10
 · Drive: carpetas, mover, favoritos, recientes, buscar, renombrar, papelera con borrado definitivo, cuota
 · Compartir por persona (lector/comentarista/editor, caducidad), comentarios, versiones y restauración
 · Edición simultánea sin pérdidas (aviso de conflicto) y presencia
 · Word: buscar y reemplazar, encabezado/pie con números de página, orientación, índice, combinar y sombrear celdas
 · Excel: fórmulas dependientes, BUSCARX, filtros, formato condicional, bordes, hojas ocultas/duplicadas, XLSX
 · PowerPoint/Publisher: imagen, animaciones, transiciones, diapositiva oculta, girar/bloquear, PDF para imprenta
 · Seguridad: lector rechazado en la interfaz y en la API, otra institución sin acceso (queda registrado), cuenta suspendida
"""
import io, json, os, re, subprocess, sys, tempfile, time, zipfile
sys.path.insert(0, os.path.dirname(__file__))
from e2e import BASE, CHROME, sql, check, shot, login, go, results
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

def download(page, click, timeout=90000):
    with page.expect_download(timeout=timeout) as d:
        click()
    return d.value.suggested_filename, open(d.value.path(), 'rb').read()

def uid(email): return sql(f"select id from profiles where email='{email}'")

def as_user(user, q):
    """Ejecuta SQL como la persona (misma seguridad que la API de Supabase)."""
    full = f"""begin; set local role authenticated; select set_config('request.jwt.claims', '{{"sub":"{user}","role":"authenticated","aal":"aal1"}}', true) \\g /dev/null
{q}; rollback;"""
    r = subprocess.run(['psql', '-h', '/tmp/pg', '-p', '54322', '-U', 'postgres', '-d', 'academy', '-tAq', '-v', 'ON_ERROR_STOP=0'], input=full, capture_output=True, text=True)
    return (r.stdout.strip().splitlines() or [''])[-1].strip() + (r.stderr.strip() and ' ERR:' + r.stderr.strip())

def saved(p, msg='guardado'):
    until(lambda: p.locator('[data-testid=estado-guardado]').inner_text().startswith('✓'), 20, msg)

def new_doc(p, kind='doc', template='blanco'):
    go(p, f'{BASE}/app/oficina'); p.click(f'[data-testid=nuevo-{kind}-{template}]')
    p.wait_for_url(re.compile(r'/app/oficina/[0-9a-f-]{36}$'), timeout=20000)
    return p.url.rsplit('/', 1)[1]

def type_doc(p, text):
    p.wait_for_selector('.ProseMirror', timeout=30000); p.click('.ProseMirror'); p.keyboard.type(text, delay=8)

def cell(p, ref, value):
    p.click(f'[data-cell={ref}]'); p.keyboard.type(value, delay=5); p.keyboard.press('Enter'); time.sleep(0.15)

def main():
    tmp = tempfile.mkdtemp()
    owner_id, prof_id, est_b = uid('propietario.a@demo.sematec.test'), uid('profesor1.a@demo.sematec.test'), uid('estudiante1.b@demo.sematec.test')
    with sync_playwright() as pw:
        b = pw.chromium.launch(executable_path=CHROME, headless=True, args=['--no-sandbox'])
        new = lambda: b.new_context(viewport={'width': 1440, 'height': 900}, accept_downloads=True, permissions=['clipboard-read', 'clipboard-write'])
        oc = new(); o = login(oc, 'propietario.a@demo.sematec.test', mfa=True)

        # ================= E2E-01 Word: crear, formatear, guardar, reabrir, DOCX =================
        doc = new_doc(o)
        o.fill('[data-testid=titulo-documento]', 'Informe anual')
        o.wait_for_selector('.ProseMirror')
        o.click('.ProseMirror'); o.select_option('[data-testid=estilo-parrafo]', 'h1'); o.keyboard.type('Introducción', delay=8); o.keyboard.press('Enter')
        o.keyboard.type('El colegio SEMATEC crece. SEMATEC enseña. ', delay=5); o.keyboard.press('Enter')
        o.select_option('[data-testid=estilo-parrafo]', 'h2'); o.keyboard.type('Resultados', delay=5); o.keyboard.press('Enter')
        o.keyboard.type('Todo bien.', delay=5)
        saved(o)
        # Buscar y reemplazar
        o.keyboard.press('Control+f'); o.wait_for_selector('[data-testid=buscar-reemplazar]')
        o.fill('[data-testid=buscar-texto]', 'sematec'); until(lambda: '2 coincidencia' in o.locator('[data-testid=buscar-resultado]').inner_text(), 5, 'coincidencias')
        check(True, 'Buscar: encuentra 2 coincidencias (sin distinguir mayúsculas)')
        o.fill('[data-testid=reemplazar-texto]', 'Academia'); o.click('[data-testid=reemplazar-todo]')
        until(lambda: '2 reemplazo' in o.locator('[data-testid=buscar-resultado]').inner_text(), 5, 'reemplazos')
        check('Academia enseña' in o.locator('.ProseMirror').inner_text() and 'SEMATEC' not in o.locator('.ProseMirror').inner_text(), 'Reemplazar todo cambia las 2 apariciones')
        # Índice, salto de página, encabezado, pie y números de página, orientación horizontal
        o.locator('.ProseMirror p', has_text='Todo bien').click(); o.keyboard.press('End')
        o.click('button:has-text("Insertar")'); o.click('[data-testid=salto-pagina]'); o.click('[data-testid=insertar-indice]')
        check(o.locator('.ProseMirror .salto-pagina').count() == 1 and 'Índice' in o.locator('.ProseMirror').inner_text(), 'Inserta salto de página e índice generado desde los títulos')
        o.click('.ProseMirror h2'); o.keyboard.press('End'); o.click('[data-testid=insertar-tabla]')
        o.click('.ProseMirror table td >> nth=0'); o.keyboard.type('Celda A', delay=5)
        o.click('[data-testid=sombreado]'); o.click('[data-testid=sombra-dcfce7]')
        check(o.locator('.ProseMirror td[data-background-color]').count() >= 1, 'Tabla con sombreado de celda')
        o.click('button:has-text("Diseño")'); o.click('[data-testid=orientacion-h]')
        o.click('[data-testid=encabezado-pie]'); o.fill('[data-testid=texto-encabezado]', 'Academia - Informe 2026'); o.fill('[data-testid=texto-pie]', 'Documento interno')
        o.click('[data-testid=numerar-paginas]'); time.sleep(0.3)
        check('Página 1' in o.locator('[data-testid=vista-pie]').inner_text() and o.locator('[data-testid=vista-encabezado]').count() == 1, 'Encabezado, pie y número de página visibles en la hoja')
        w = o.locator('[data-testid=hoja-documento]').bounding_box()
        check(w['width'] > w['height'] * 0.9, 'Orientación horizontal aplicada a la hoja')
        saved(o)
        row = sql(f"select (content->'page'->>'orient')||'|'||(content->'page'->>'pageNumbers')||'|'||(content->'page'->>'header') from office_documents where id='{doc}'")
        check(row == 'h|true|Academia - Informe 2026', f'Diseño de página guardado ({row})')
        o.reload(); o.wait_for_selector('.ProseMirror h1', timeout=30000)
        check('Introducción' in o.locator('.ProseMirror h1').inner_text() and 'Academia enseña' in o.locator('.ProseMirror').inner_text(), 'E2E-01: al reabrir conserva formato y contenido')
        o.click('[data-testid=oficina-descargar]'); name, data = download(o, lambda: o.click('[data-testid=exportar-docx]'))
        z = zipfile.ZipFile(io.BytesIO(data)); docxml = z.read('word/document.xml').decode()
        headers = ''.join(z.read(n).decode() for n in z.namelist() if re.match(r'word/(header|footer)\d*\.xml', n))
        check(name == 'Informe anual.docx' and 'Introducción' in docxml and 'w:orient="landscape"' in docxml, 'DOCX: contenido y página horizontal')
        check('Academia - Informe 2026' in headers and 'Documento interno' in headers and 'PAGE' in headers and 'NUMPAGES' in headers, 'DOCX: encabezado, pie y campos de número de página')
        check('w:br w:type="page"' in docxml and 'w:shd' in docxml, 'DOCX: salto de página y sombreado de celda')
        o.click('[data-testid=oficina-descargar]'); name, data = download(o, lambda: o.click('[data-testid=exportar-pdf]'))
        import pypdf
        rd = pypdf.PdfReader(io.BytesIO(data)); txt = rd.pages[0].extract_text() + (rd.pages[1].extract_text() if len(rd.pages) > 1 else '')
        check(len(rd.pages) >= 2 and 'Academia - Informe 2026' in txt and 'Página 1 de' in txt and rd.pages[0].mediabox.width > rd.pages[0].mediabox.height, 'PDF: 2 páginas, horizontal, con encabezado y «Página 1 de N»')
        o.keyboard.press('Escape')

        # ================= Versiones (E2E-10) =================
        o.click('[data-testid=oficina-versiones]'); o.fill('[data-testid=version-nombre]', 'Versión aprobada'); o.click('[data-testid=guardar-version]')
        until(lambda: 'Versión guardada' in o.locator('[data-testid=version-aviso]').inner_text(), 10, 'versión')
        o.click('[aria-label="Cerrar panel"]')
        o.click('.ProseMirror h1'); o.keyboard.press('End'); o.keyboard.type(' BORRADOR MALO', delay=5); saved(o)
        check('BORRADOR MALO' in sql(f"select content->>'html' from office_documents where id='{doc}'"), 'Cambio posterior guardado')
        o.click('[data-testid=oficina-versiones]'); o.wait_for_selector('[data-testid=lista-versiones] li')
        o.once('dialog', lambda d: d.accept())
        o.locator('[data-testid=lista-versiones] li', has_text='Versión aprobada').locator('[data-testid=restaurar-version]').click()
        until(lambda: 'BORRADOR MALO' not in sql(f"select content->>'html' from office_documents where id='{doc}'"), 15, 'restaurada')
        until(lambda: o.locator('[data-testid=panel-versions]').count() == 0 and 'BORRADOR MALO' not in o.locator('.ProseMirror').inner_text(), 20, 'recarga')
        o.wait_for_load_state('networkidle'); o.wait_for_selector('.ProseMirror h1', timeout=30000)
        check('BORRADOR MALO' not in o.locator('.ProseMirror').inner_text() and 'Introducción' in o.locator('.ProseMirror').inner_text(), 'E2E-10: restaurar una versión anterior recupera el contenido')
        check(sql(f"select count(*) from office_versions where document_id='{doc}' and label like 'Antes de restaurar%'") == '1', 'Antes de restaurar se guarda la versión actual (se puede deshacer)')

        # ================= Drive =================
        go(o, f'{BASE}/app/oficina?v=mios')
        o.click('[data-testid=nueva-carpeta]'); o.fill('[data-testid=carpeta-nombre]', 'Informes 2026'); o.click('[data-testid=carpeta-crear]')
        o.wait_for_selector('[data-testid=carpeta]:has-text("Informes 2026")')
        folder = sql("select id from office_folders where name='Informes 2026'")
        it = o.locator('[data-testid=doc-oficina]', has_text='Informe anual')
        it.locator('[data-testid=doc-opciones]').click(); it.locator('[data-testid=doc-carpeta]').select_option(folder); it.locator('[data-testid=doc-mover]').click()
        o.wait_for_load_state('networkidle')
        until(lambda: sql(f"select folder_id from office_documents where id='{doc}'") == folder, 10, 'mover'); check(True, 'Drive: documento movido a la carpeta')
        go(o, f'{BASE}/app/oficina?v=mios&carpeta={folder}')
        check(o.locator('[data-testid=doc-oficina]', has_text='Informe anual').count() == 1 and 'Informes 2026' in o.locator('[data-testid=drive-titulo]').inner_text(), 'Drive: la carpeta muestra su contenido y la ruta')
        it = o.locator('[data-testid=doc-oficina]', has_text='Informe anual'); it.locator('[data-testid=favorito]').click()
        until(lambda: sql(f"select starred from office_marks where document_id='{doc}'") == 't', 10, 'favorito')
        go(o, f'{BASE}/app/oficina?v=favoritos')
        check(o.locator('[data-testid=doc-oficina]', has_text='Informe anual').count() == 1, 'Drive: favoritos')
        go(o, f'{BASE}/app/oficina?v=recientes')
        check(o.locator('[data-testid=doc-oficina]', has_text='Informe anual').count() == 1, 'Drive: recientes (documentos abiertos)')
        go(o, f'{BASE}/app/oficina?q=anual')
        check(o.locator('[data-testid=doc-oficina]').count() == 1, 'Drive: búsqueda por nombre')
        check(o.locator('[data-testid=cuota]').count() == 1 and 'de 2.0' in o.locator('[data-testid=cuota]').inner_text().replace(',', '.') or 'GB' in o.locator('[data-testid=cuota]').inner_text(), 'Drive: espacio usado y límite')
        # renombrar, papelera, restaurar, borrar definitivamente
        tmpdoc = new_doc(o); type_doc(o, 'Temporal'); saved(o)
        go(o, f'{BASE}/app/oficina?v=mios')
        it = o.locator('[data-testid=doc-oficina]').filter(has=o.locator(f'a[href="/app/oficina/{tmpdoc}"]'))
        it.locator('[data-testid=doc-opciones]').click(); it.locator('[data-testid=doc-nuevo-nombre]').fill('Borrador temporal'); it.locator('[data-testid=doc-renombrar]').click(); o.wait_for_load_state('networkidle')
        until(lambda: sql(f"select title from office_documents where id='{tmpdoc}'") == 'Borrador temporal', 10, 'renombrar'); check(True, 'Drive: renombrar')
        go(o, f'{BASE}/app/oficina?v=mios')
        it = o.locator('[data-testid=doc-oficina]', has_text='Borrador temporal'); it.locator('[data-testid=doc-opciones]').click(); it.locator('[data-testid=doc-papelera]').click()
        until(lambda: sql(f"select deleted_at is not null from office_documents where id='{tmpdoc}'") == 't', 10, 'papelera')
        go(o, f'{BASE}/app/oficina?v=papelera')
        it = o.locator('[data-testid=doc-oficina]', has_text='Borrador temporal'); it.locator('[data-testid=doc-opciones]').click(); it.locator('[data-testid=doc-restaurar]').click(); o.wait_for_load_state('networkidle')
        until(lambda: sql(f"select deleted_at is null from office_documents where id='{tmpdoc}'") == 't', 10, 'restaurar'); check(True, 'Drive: papelera y restaurar')
        sql(f"update office_documents set deleted_at=now() where id='{tmpdoc}'")
        go(o, f'{BASE}/app/oficina?v=papelera')
        it = o.locator('[data-testid=doc-oficina]', has_text='Borrador temporal'); it.locator('[data-testid=doc-opciones]').click(); it.locator('[data-testid=doc-borrar]').click()
        check('No se puede deshacer' in it.inner_text(), 'Borrado definitivo pide confirmación explícita')
        it.locator('[data-testid=doc-borrar-confirmar]').click(); o.wait_for_load_state('networkidle')
        until(lambda: sql(f"select count(*) from office_documents where id='{tmpdoc}'") == '0', 10, 'borrado'); check(True, 'Drive: borrado definitivo (solo el dueño)')
        shot(o, 'oficina_drive_01')

        # ================= E2E-05 Compartir como lector: rechazado en interfaz y API =================
        go(o, f'{BASE}/app/oficina/{doc}'); o.wait_for_selector('.ProseMirror')
        o.click('[data-testid=oficina-compartir]'); o.fill('[data-testid=compartir-buscar]', 'profesor1')
        o.locator('[data-testid=compartir-persona]', has_text='profesor1').first.click()
        o.select_option('[data-testid=compartir-permiso]', 'viewer'); o.click('[data-testid=compartir-agregar]')
        until(lambda: 'Compartido con' in o.locator('[data-testid=compartir-aviso]').inner_text(), 10, 'compartido')
        check(sql(f"select permission from office_shares where document_id='{doc}' and grantee_id='{prof_id}'") == 'viewer', 'Compartido con una persona como lector')
        o.click('[aria-label="Cerrar panel"]')
        tc = new(); t = login(tc, 'profesor1.a@demo.sematec.test'); t.on('dialog', lambda d: print('DIALOGO', d.type, d.message))
        go(t, f'{BASE}/app/oficina?v=compartidos')
        check(t.locator('[data-testid=doc-oficina]', has_text='Informe anual').count() == 1, 'El lector lo ve en «Compartidos conmigo»')
        go(t, f'{BASE}/app/oficina/{doc}'); t.wait_for_selector('.ProseMirror')
        check('Solo lectura' in t.locator('[data-testid=estado-guardado]').inner_text() and t.locator('.ProseMirror[contenteditable=true]').count() == 0 and t.locator('[data-testid=cinta-word]').count() == 0, 'E2E-05: lector sin edición en la interfaz')
        r = as_user(prof_id, f"update office_documents set title='hackeado' where id='{doc}' returning id")
        check(r == '' and sql(f"select title from office_documents where id='{doc}'") == 'Informe anual', f'E2E-05: la API rechaza que el lector edite ({r or "0 filas"})')
        r = as_user(prof_id, f"insert into office_comments(document_id, organization_id, body) values ('{doc}','{ORG}','x') returning id")
        check('ERR' in r, 'El lector tampoco puede comentar (API)')
        # comentarista
        sql(f"update office_shares set permission='commenter' where document_id='{doc}' and grantee_id='{prof_id}'")
        t.reload(); t.wait_for_selector('.ProseMirror')
        t.click('[data-testid=oficina-comentarios]'); t.fill('[data-testid=comentario-texto]', 'Revisar la introducción'); t.click('[data-testid=comentario-enviar]')
        t.wait_for_selector('[data-testid=comentario]:has-text("Revisar la introducción")')
        check('Puede comentar' in t.locator('[data-testid=estado-guardado]').inner_text() and t.locator('.ProseMirror[contenteditable=true]').count() == 0, 'Comentarista: comenta pero no edita')
        go(o, f'{BASE}/app/oficina/{doc}'); o.wait_for_selector('.ProseMirror'); o.click('[data-testid=oficina-comentarios]')
        o.wait_for_selector('[data-testid=comentario]:has-text("Revisar la introducción")'); o.click('[data-testid=comentario-resolver]')
        until(lambda: sql(f"select resolved from office_comments where document_id='{doc}'") == 't', 10, 'resuelto')
        check(True, 'El dueño ve y resuelve el comentario')
        o.click('[aria-label="Cerrar panel"]')
        # caducidad
        sql(f"update office_shares set expires_at=now()-interval '1 minute' where document_id='{doc}' and grantee_id='{prof_id}'")
        t.goto(f'{BASE}/app/oficina/{doc}'); t.wait_for_load_state('networkidle')
        check(t.locator('.ProseMirror').count() == 0, 'Acceso compartido caducado: ya no puede abrirlo')

        # ================= E2E-06 Otra institución: sin acceso y registrado =================
        xc = new(); x = login(xc, 'estudiante1.b@demo.sematec.test')
        x.goto(f'{BASE}/app/oficina/{doc}'); x.wait_for_load_state('networkidle')
        check(x.locator('.ProseMirror').count() == 0 and 'Informe anual' not in x.content(), 'E2E-06: otra institución no puede abrir el documento')
        check(as_user(est_b, f"select count(*) from office_documents where id='{doc}'") == '0', 'E2E-06: tampoco por la API')
        check(sql(f"select count(*) from system_events where event_type='office_access_denied' and user_id='{est_b}' and details->>'document_id'='{doc}'") == '1', 'E2E-06: el intento queda registrado para seguridad')
        xc.close()

        # ================= E2E-07 Dos editores a la vez: sin pérdidas silenciosas =================
        sql(f"update office_shares set permission='editor', expires_at=null where document_id='{doc}' and grantee_id='{prof_id}'")
        go(t, f'{BASE}/app/oficina/{doc}'); t.wait_for_selector('.ProseMirror[contenteditable=true]', timeout=30000)
        go(o, f'{BASE}/app/oficina/{doc}'); o.wait_for_selector('.ProseMirror[contenteditable=true]')
        until(lambda: o.locator('[data-testid=presencia]').count() == 1 and 'rofesor' in o.locator('[data-testid=presencia]').inner_text(), 25, 'presencia')
        check(True, 'Presencia: el dueño ve que el profesor también tiene el documento abierto')
        o.click('.ProseMirror h1'); o.keyboard.press('End'); o.keyboard.type(' (dueño)', delay=5); saved(o)
        t.click('.ProseMirror h1'); t.keyboard.press('End'); t.keyboard.type(' (profesor)', delay=5)
        t.wait_for_selector('[data-testid=aviso-conflicto]', timeout=20000)
        html = sql(f"select content->>'html' from office_documents where id='{doc}'")
        check('(dueño)' in html and '(profesor)' not in html, 'E2E-07: el segundo guardado NO sobrescribe en silencio')
        check('no se han perdido' in t.locator('[data-testid=aviso-conflicto]').inner_text(), 'Aviso de conflicto con opciones para el profesor')
        t.click('[data-testid=conflicto-copia]')
        t.wait_for_url(lambda u: re.search(r'/app/oficina/[0-9a-f-]{36}$', u) is not None and not u.endswith(doc), timeout=40000)
        copy_html = sql(f"select content->>'html' from office_documents where id='{t.url.rsplit('/', 1)[1]}'")
        check('(profesor)' in copy_html and sql(f"select title from office_documents where id='{t.url.rsplit('/', 1)[1]}'").endswith('(mi versión)'), 'Los cambios del profesor quedan en una copia «(mi versión)»')
        # aviso de cambio remoto para quien solo mira
        go(t, f'{BASE}/app/oficina/{doc}'); t.wait_for_selector('.ProseMirror')
        o.click('.ProseMirror h1'); o.keyboard.press('End'); o.keyboard.type('!', delay=5); saved(o)
        t.wait_for_selector('[data-testid=aviso-cambio-remoto]', timeout=25000)
        check(True, 'Quien tiene el documento abierto recibe aviso de la versión nueva')
        shot(t, 'oficina_drive_02_remoto')

        # ================= E2E-09 Cuenta suspendida por la administración =================
        sql(f"update memberships set status='suspended' where user_id='{prof_id}' and organization_id='{ORG}'")
        t.goto(f'{BASE}/app/oficina/{doc}'); t.wait_for_load_state('networkidle')
        check(t.locator('.ProseMirror').count() == 0, 'E2E-09: cuenta suspendida pierde el acceso al documento')
        check(as_user(prof_id, f"update office_documents set title='x' where id='{doc}' returning id") == '', 'E2E-09: ni por la API')
        sql(f"update memberships set status='active' where user_id='{prof_id}' and organization_id='{ORG}'")
        tc.close()

        # ================= E2E-02 Excel: fórmulas dependientes, BUSCARX, filtros, condicional, XLSX =================
        sh = new_doc(o, 'sheet')
        o.wait_for_selector('[data-cell=A1]', timeout=30000)
        for ref, v in [('A1', 'Nombre'), ('B1', 'Nota'), ('A2', 'Ana'), ('B2', '6,5'), ('A3', 'Luis'), ('B3', '3,2'), ('A4', 'Eva'), ('B4', '5')]: cell(o, ref, v)
        cell(o, 'C1', 'Total'); cell(o, 'C2', '=SUMA(B2:B4)'); cell(o, 'C3', '=C2*2'); cell(o, 'C4', '=BUSCARX("Luis";A2:A4;B2:B4;"no")')
        until(lambda: o.locator('[data-cell=C3]').inner_text().strip() in ('29,4', '29.4'), 10, 'dependiente')
        check(o.locator('[data-cell=C4]').inner_text().strip() in ('3,2', '3.2'), 'BUSCARX (XLOOKUP) en español')
        cell(o, 'B4', '7')
        until(lambda: o.locator('[data-cell=C3]').inner_text().strip() in ('33,4', '33.4'), 10, 'recalculo')
        check(True, 'E2E-02: al cambiar un dato se recalculan las fórmulas dependientes (C2 y C3)')
        # bordes y formato condicional en B2:B4
        o.click('[data-cell=B2]'); o.click('[data-cell=B4]', modifiers=['Shift'])
        o.click('[data-testid=menu-bordes]'); o.click('[data-testid=bordes-all]')
        o.click('[data-testid=menu-condicional]'); o.select_option('[data-testid=condicional-op]', '<'); o.fill('[data-testid=condicional-valor]', '4'); o.click('[data-testid=condicional-agregar]')
        o.keyboard.press('Escape'); o.click('[data-cell=E8]')
        until(lambda: 'rgb(254, 226, 226)' in (o.locator('[data-cell=B3]').get_attribute('style') or ''), 10, 'condicional')
        check('rgb(254, 226, 226)' not in (o.locator('[data-cell=B2]').get_attribute('style') or '') and 'solid' in (o.locator('[data-cell=B2]').get_attribute('style') or ''), 'Formato condicional (nota < 4 en rojo) y bordes')
        # filtro
        o.click('[data-cell=A1]'); o.click('[data-testid=boton-filtro]'); o.fill('[data-testid=filtro-A]', 'eva')
        until(lambda: o.locator('[data-cell=A2]').count() == 0 and o.locator('[data-cell=A4]').count() == 1, 10, 'filtro')
        check(o.locator('[data-cell=A1]').count() == 1, 'Filtro: solo las filas que coinciden (encabezado visible)')
        o.fill('[data-testid=filtro-A]', '')
        # hojas: duplicar, mover, ocultar, mostrar
        o.click('[data-testid=opciones-hoja]'); o.click('[data-testid=duplicar-hoja]')
        until(lambda: o.locator('[data-testid=pestana-hoja]').count() == 2, 5, 'duplicada')
        o.click('[data-testid=opciones-hoja]'); o.click('[data-testid=ocultar-hoja]')
        until(lambda: o.locator('[data-testid=pestana-hoja]').count() == 1 and o.locator('[data-testid=mostrar-hoja]').count() == 1, 5, 'oculta')
        check(True, 'Hojas: duplicar y ocultar (con opción de volver a mostrar)')
        saved(o, 'hoja')
        o.click('[data-testid=oficina-descargar]'); name, data = download(o, lambda: o.click('[data-testid=exportar-xlsx]'))
        import openpyxl
        wb = openpyxl.load_workbook(io.BytesIO(data)); ws = wb.worksheets[0]
        check(ws['C2'].value == '=SUM(B2:B4)' and ws['C3'].value == '=C2*2' and 'XLOOKUP' in str(ws['C4'].value), 'E2E-02: XLSX con fórmulas dependientes')
        check(ws.auto_filter.ref is not None and len(ws.conditional_formatting) >= 1 and ws['B2'].border.top.style == 'thin', 'XLSX con filtro, formato condicional y bordes')
        check(len(wb.worksheets) == 2 and wb.worksheets[1].sheet_state == 'hidden', 'XLSX con la hoja oculta')
        wbv = openpyxl.load_workbook(io.BytesIO(data), data_only=True)
        check(abs(float(wbv.worksheets[0]['C3'].value) - 33.4) < 1e-6, 'XLSX con los resultados calculados')
        # filas virtualizadas: 5000 filas sin bloquear
        o.click('[data-testid=mas-filas]'); o.click('[data-testid=mas-filas]'); o.click('[data-testid=mas-filas]'); o.click('[data-testid=mas-filas]'); o.click('[data-testid=mas-filas]')
        check(o.locator('[data-testid=grilla] tbody tr').count() < 200, f'Hoja grande (miles de filas) dibujando solo las visibles')

        # ================= E2E-03 Presentación con imagen, animación, transición y pantalla completa =================
        from PIL import Image
        img = os.path.join(tmp, 'foto.png'); Image.new('RGB', (320, 200), (30, 90, 200)).save(img)
        sl = new_doc(o, 'slides', 'azul'); o.wait_for_selector('[data-testid=lienzo]', timeout=30000)
        o.locator('input[type=file][accept^="image"]').set_input_files(img)
        until(lambda: o.locator('[data-testid=lienzo] img').count() == 1, 10, 'imagen')
        o.click('[data-testid=menu-organizar]'); o.select_option('[data-testid=animacion]', 'fly'); o.click('[data-testid=alinear-centroH]')
        o.click('[data-testid=menu-organizar]'); o.click('[data-testid=girar-90]')
        o.keyboard.press('Escape'); o.click('[data-testid=bloquear]')
        saved(o, 'ppt')
        e = json.loads(sql(f"select e::text from office_documents d, jsonb_array_elements(d.content->'deck'->'pages'->0->'els') e where d.id='{sl}' and e->>'type'='image'"))
        check(e.get('anim') == 'fly' and e.get('rot') == 90 and e.get('lock') is True, f'Imagen con animación, girada 90° y bloqueada')
        o.click('summary:has-text("Diseño")'); o.select_option('[data-testid=transicion]', 'fade')
        o.click('[data-testid=miniaturas] > div >> nth=1'); o.click('summary:has-text("Diseño")'); o.check('[data-testid=ocultar-diapositiva]')
        saved(o, 'ppt2')
        o.click('[data-testid=presentar]'); o.wait_for_selector('[data-testid=modo-presentacion]')
        check('1 / 1' in o.locator('[data-testid=contador-presentacion]').inner_text(), 'Presentación omite la diapositiva oculta')
        img_style = o.locator('[data-testid=modo-presentacion] img').get_attribute('style')
        check('opacity: 0' in img_style, 'La imagen animada aparece al hacer clic')
        o.locator('[data-testid=modo-presentacion]').click(position={'x': 50, 'y': 50}); time.sleep(0.8)
        check('opacity: 0' not in o.locator('[data-testid=modo-presentacion] img').get_attribute('style') and 'anim-fly' in o.locator('[data-testid=modo-presentacion] img').get_attribute('style'), 'E2E-03: animación de entrada en modo presentación')
        shot(o, 'oficina_drive_03_presentacion')
        o.keyboard.press('Escape')
        o.click('[data-testid=oficina-descargar]'); name, data = download(o, lambda: o.click('[data-testid=exportar-pptx]'))
        z = zipfile.ZipFile(io.BytesIO(data))
        check(any(n.startswith('ppt/media/') for n in z.namelist()) and 'rot="5400000"' in z.read('ppt/slides/slide1.xml').decode(), 'PPTX con la imagen girada')

        # ================= E2E-04 Diploma en PDF (y PDF para imprenta) =================
        new_doc(o, 'pub', 'diploma'); o.wait_for_selector('[data-testid=lienzo]', timeout=30000)
        o.click('summary:has-text("Diseño")'); o.check('[data-testid=ajustar-cuadricula]')
        check(o.locator('[data-testid=cuadricula]').count() == 1, 'Publisher: cuadrícula de ajuste')
        o.keyboard.press('Escape')
        o.click('[data-testid=oficina-descargar]'); name, data = download(o, lambda: o.click('[data-testid=exportar-pdf]'))
        import pypdf
        pg = pypdf.PdfReader(io.BytesIO(data)).pages[0]
        check(data[:4] == b'%PDF' and name.endswith('.pdf') and round(float(pg.mediabox.width)) == 842 and round(float(pg.mediabox.height)) == 595, 'E2E-04: diploma en PDF (A4 horizontal)')
        o.click('[data-testid=oficina-descargar]'); name, data = download(o, lambda: o.click('[data-testid=exportar-pdf-imprenta]'))
        pg = pypdf.PdfReader(io.BytesIO(data)).pages[0]
        check(round(float(pg.mediabox.width)) == 898 and round(float(pg.trimbox.width)) == 842 and round(float(pg.bleedbox.width)) == 859, 'PDF para imprenta con sangrado (3 mm), área de corte y marcas')
        for t_ in ['calendario', 'triptico', 'folleto']:
            new_doc(o, 'pub', t_); o.wait_for_selector('[data-testid=lienzo]', timeout=30000)
        check(o.locator('[data-testid=lienzo] [data-el]').count() > 3, 'Plantillas nuevas: calendario, tríptico y folleto')

        # ================= E2E-08 Persistencia tras reiniciar el servidor =================
        subprocess.run(['bash', '/tmp/restart_next.sh'], check=True)
        until(lambda: subprocess.run(['curl', '-s', '-o', '/dev/null', '-w', '%{http_code}', f'{BASE}/login'], capture_output=True, text=True).stdout == '200', 60, 'servidor')
        go(o, f'{BASE}/app/oficina/{doc}'); o.wait_for_selector('.ProseMirror h1', timeout=30000)
        check('(dueño)' in o.locator('.ProseMirror').inner_text() and 'Índice' in o.locator('.ProseMirror').inner_text(), 'E2E-08: tras reiniciar el servidor el documento sigue intacto')
        go(o, f'{BASE}/app/oficina/{sh}'); o.wait_for_selector('[data-cell=C3]', timeout=30000)
        until(lambda: o.locator('[data-cell=C3]').inner_text().strip() in ('33,4', '33.4'), 15, 'hoja tras reinicio')
        check(True, 'E2E-08: la hoja de cálculo también persiste')
        b.close()

    ok = sum(1 for r in results if r[0]); print(f'\n{ok}/{len(results)} verificaciones OK')

if __name__ == '__main__':
    main()
