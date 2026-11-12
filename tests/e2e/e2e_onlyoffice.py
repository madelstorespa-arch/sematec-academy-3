"""
Conexión con ONLYOFFICE Docs (servidor simulado que se comporta como el real):
 · Abrir un Excel/Word con formato exacto, configuración firmada (JWT), permisos según el acceso
 · El servidor ONLYOFFICE descarga el archivo con enlace firmado; avisa el guardado (estado 2) y se guarda una versión nueva
 · Seguridad: JWT inválido, descarga desde otro servidor (SSRF), persona sin permiso y sesión anterior: rechazados
 · Convertir un documento propio a ONLYOFFICE y volver a la versión anterior; copiar; sin servidor: descargar el original
"""
import base64, hashlib, hmac, http.server, io, json, os, re, subprocess, sys, tempfile, threading, time, urllib.request, urllib.error
sys.path.insert(0, os.path.dirname(__file__))
from e2e import BASE, CHROME, sql, check, shot, login, go, results
from playwright.sync_api import sync_playwright

SECRET = 'sematec-prueba-onlyoffice'
STUB = 'http://127.0.0.1:8765'
FILES = {}
API_JS = b"""window.DocsAPI = { DocEditor: function (id, cfg) {
  var el = document.getElementById(id); el.id = 'oo-stub'; el.setAttribute('data-config', JSON.stringify(cfg));
  el.textContent = 'ONLYOFFICE (simulado): ' + cfg.document.title; return { destroyEditor: function () {} };
} };"""

class Stub(http.server.BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def do_GET(self):
        if self.path == '/web-apps/apps/api/documents/api.js': body, ct = API_JS, 'application/javascript'
        elif self.path in FILES: body, ct = FILES[self.path], 'application/octet-stream'
        else: self.send_response(404); self.end_headers(); return
        self.send_response(200); self.send_header('Content-Type', ct); self.send_header('Content-Length', str(len(body))); self.end_headers(); self.wfile.write(body)

def restart(env):
    subprocess.run("pkill -f next-server; pkill -f 'next start'; sleep 1", shell=True)
    e = {**os.environ, **env}
    subprocess.Popen('nohup npx next start -p 3000 > /tmp/next.log 2>&1 &', shell=True, cwd='/home/claude/sematec-academy', env=e)
    end = time.time() + 60
    while time.time() < end:
        try:
            if urllib.request.urlopen(f'{BASE}/login', timeout=3).status == 200: return
        except Exception: time.sleep(0.5)
    raise AssertionError('Next no inició')

def b64u(b): return base64.urlsafe_b64encode(b).rstrip(b'=').decode()
def jwt(payload, secret=SECRET):
    h = b64u(json.dumps({'alg': 'HS256', 'typ': 'JWT'}).encode()); p = b64u(json.dumps({**payload, 'exp': int(time.time()) + 600}).encode())
    return f'{h}.{p}.{b64u(hmac.new(secret.encode(), f"{h}.{p}".encode(), hashlib.sha256).digest())}'
def jwt_ok(tok):
    h, p, s = tok.split('.')
    return hmac.compare_digest(b64u(hmac.new(SECRET.encode(), f'{h}.{p}'.encode(), hashlib.sha256).digest()), s)

def http_get(url):
    try:
        r = urllib.request.urlopen(url, timeout=20); return r.status, r.read()
    except urllib.error.HTTPError as e: return e.code, e.read()
def http_post(url, obj, headers=None):
    req = urllib.request.Request(url, data=json.dumps(obj).encode(), headers={'Content-Type': 'application/json', **(headers or {})}, method='POST')
    try:
        r = urllib.request.urlopen(req, timeout=60); return r.status, json.loads(r.read() or b'{}')
    except urllib.error.HTTPError as e: return e.code, json.loads(e.read() or b'{}')

def until(fn, timeout=20, msg=''):
    end = time.time() + timeout
    while time.time() < end:
        try:
            if fn(): return True
        except Exception: pass
        time.sleep(0.4)
    raise AssertionError(f'Tiempo agotado: {msg}')

def config(page):
    page.wait_for_selector('#oo-stub', timeout=30000)
    return json.loads(page.get_attribute('#oo-stub', 'data-config'))

def uid(email): return sql(f"select id from profiles where email='{email}'")

def main():
    import openpyxl, docx
    tmp = tempfile.mkdtemp()
    srv = http.server.ThreadingHTTPServer(('127.0.0.1', 8765), Stub); threading.Thread(target=srv.serve_forever, daemon=True).start()
    owner, prof, est_b = uid('propietario.a@demo.sematec.test'), uid('profesor1.a@demo.sematec.test'), uid('estudiante1.b@demo.sematec.test')
    wb = openpyxl.Workbook(); wb.active['A1'] = 'Notas originales'; wb.active['B2'] = 6.5
    xlsx = os.path.join(tmp, 'Notas curso.xlsx'); wb.save(xlsx); original = open(xlsx, 'rb').read()
    restart({'ONLYOFFICE_URL': STUB, 'ONLYOFFICE_JWT_SECRET': SECRET, 'ONLYOFFICE_APP_URL': 'http://127.0.0.1:3000'})
    try:
        with sync_playwright() as pw:
            b = pw.chromium.launch(executable_path=CHROME, headless=True, args=['--no-sandbox'])
            new = lambda: b.new_context(viewport={'width': 1440, 'height': 900}, accept_downloads=True)
            oc = new(); o = login(oc, 'propietario.a@demo.sematec.test', mfa=True)
            errors = []; o.on('console', lambda m: errors.append(m.text) if 'Content Security Policy' in m.text else None)

            # 1. Abrir un Excel con formato exacto
            go(o, f'{BASE}/app/oficina')
            check(o.locator('[data-testid=importar-exacto]').is_checked(), 'Con ONLYOFFICE activo se ofrece abrir Word/Excel/PowerPoint con formato exacto')
            o.set_input_files('[data-testid=importar-oficina]', xlsx)
            o.wait_for_url(re.compile(r'/app/oficina/[0-9a-f-]{36}$'), timeout=30000)
            doc = o.url.rsplit('/', 1)[1]
            cfg = config(o)
            check(not errors, 'El editor ONLYOFFICE carga sin bloqueos de seguridad del navegador (CSP)')
            check(cfg['documentType'] == 'cell' and cfg['document']['fileType'] == 'xlsx' and cfg['document']['title'] == 'Notas curso.xlsx', 'Configuración: hoja de cálculo XLSX con su nombre')
            check(cfg['document']['permissions']['edit'] is True and cfg['editorConfig']['mode'] == 'edit' and cfg['editorConfig']['user']['id'] == owner and cfg['editorConfig']['lang'] == 'es', 'Dueño: edición, en español, con su identidad')
            check(jwt_ok(cfg['token']), 'Configuración firmada con el secreto JWT (ONLYOFFICE la valida)')
            shot(o, 'onlyoffice_01')
            path0 = sql(f"select content->'oo'->>'path' from office_documents where id='{doc}'")
            check(path0.startswith(f'oficina/{"0a000000-0000-4000-8000-000000000001"}/{doc}/') and sql(f"select kind from office_documents where id='{doc}'") == 'sheet', 'El archivo queda en el almacenamiento privado de la institución')

            # 2. ONLYOFFICE descarga el archivo
            st, data = http_get(cfg['document']['url'])
            check(st == 200 and data == original, 'ONLYOFFICE descarga el archivo original con el enlace firmado')
            st, _ = http_get(re.sub(r's=[^&]+', 's=AAAA', cfg['document']['url']))
            st2, _ = http_get(cfg['document']['url'].replace(path0.replace('/', '%2F'), path0.replace('/', '%2F').replace('.xlsx', '.docx')))
            check(st == 403 and st2 == 403, 'Enlace alterado o de otro archivo: rechazado')

            # 3. Guardado (estado 2) → versión nueva
            wb2 = openpyxl.Workbook(); wb2.active['A1'] = 'Editado en ONLYOFFICE'; out = io.BytesIO(); wb2.save(out); edited = out.getvalue()
            FILES['/cache/edited.xlsx'] = edited
            key0 = cfg['document']['key']; cb = cfg['editorConfig']['callbackUrl']
            st, r = http_post(cb, {'token': jwt({'key': key0, 'status': 1, 'users': [owner]})})
            check(st == 200 and r.get('error') == 0, 'Aviso «editando» (estado 1) respondido con {"error":0}')
            v0 = sql(f"select version from office_documents where id='{doc}'")
            # ataques primero: nada debe cambiar
            st, _ = http_post(cb, {'token': jwt({'key': key0, 'status': 2, 'url': f'{STUB}/cache/edited.xlsx', 'users': [owner]}, 'otro-secreto')})
            check(st == 403, 'JWT con otro secreto: rechazado')
            st, _ = http_post(cb, {'token': jwt({'key': key0, 'status': 2, 'url': f'http://127.0.0.1:3000/login', 'users': [owner]})})
            check(st == 400, 'Archivo desde otro servidor (SSRF): rechazado')
            st, _ = http_post(cb, {'token': jwt({'key': key0, 'status': 2, 'url': f'{STUB}/cache/edited.xlsx', 'users': [est_b]})})
            check(st == 403, 'Guardado a nombre de una persona de otra institución: rechazado')
            st, _ = http_post(re.sub(r's=[^&]+', 's=XXXX', cb), {'token': jwt({'key': key0, 'status': 2, 'url': f'{STUB}/cache/edited.xlsx', 'users': [owner]})})
            check(st == 403, 'Dirección de aviso alterada: rechazada')
            check(sql(f"select version from office_documents where id='{doc}'") == v0, 'Ningún intento rechazado modificó el documento')
            st, r = http_post(cb, {'token': jwt({'key': key0, 'status': 2, 'url': f'{STUB}/cache/edited.xlsx', 'users': [owner], 'filetype': 'xlsx'})})
            check(st == 200 and r.get('error') == 0, 'Guardado de ONLYOFFICE (estado 2) aceptado')
            row = sql(f"select (content->'oo'->>'path')<>'{path0}', (content->'oo'->>'key')<>'{key0}', version>{v0} from office_documents where id='{doc}'")
            check(row == 't|t|t', f'Archivo nuevo, clave de sesión nueva y versión incrementada ({row})')
            check(sql(f"select count(*) from office_versions where document_id='{doc}' and content->'oo'->>'path'='{path0}'") == '1', 'La versión anterior queda en el historial')
            st, _ = http_post(cb, {'token': jwt({'key': key0, 'status': 2, 'url': f'{STUB}/cache/edited.xlsx', 'users': [owner]})})
            check(sql(f"select count(*) from office_versions where document_id='{doc}'") == '1', 'Aviso repetido de la sesión anterior: ignorado (sin duplicar versiones)')
            o.reload(); cfg2 = config(o)
            st, data = http_get(cfg2['document']['url'])
            check(cfg2['document']['key'] != key0 and data == edited, 'Al reabrir se edita el archivo guardado por ONLYOFFICE')
            # guardado forzado (6) mantiene la clave para seguir coeditando
            http_post(cfg2['editorConfig']['callbackUrl'], {'token': jwt({'key': cfg2['document']['key'], 'status': 6, 'url': f'{STUB}/cache/edited.xlsx', 'users': [owner], 'filetype': 'xlsx'})})
            check(sql(f"select content->'oo'->>'key' from office_documents where id='{doc}'") == cfg2['document']['key'] and sql(f"select count(*) from office_versions where document_id='{doc}'") == '2', 'Guardado forzado (estado 6): versión nueva sin cortar la coedición')

            # 4. Permisos de otras personas
            sql(f"insert into office_shares(organization_id, document_id, grantee_id, permission, created_by) values ('0a000000-0000-4000-8000-000000000001','{doc}','{prof}','viewer','{owner}')")
            tc = new(); t = login(tc, 'profesor1.a@demo.sematec.test')
            go(t, f'{BASE}/app/oficina/{doc}'); ct = config(t)
            check(ct['editorConfig']['mode'] == 'view' and ct['document']['permissions']['edit'] is False and ct['editorConfig']['user']['id'] == prof, 'Lector: ONLYOFFICE en modo solo lectura')
            r = t.request.post(f'{BASE}/api/oficina/onlyoffice/subir', data={'id': doc, 'ext': 'xlsx', 'size': 100})
            check(r.status == 403, 'Lector no puede reemplazar el archivo (API)')
            st, _ = http_post(ct['editorConfig']['callbackUrl'], {'token': jwt({'key': ct['document']['key'], 'status': 2, 'url': f'{STUB}/cache/edited.xlsx', 'users': [prof]})})
            check(st == 403, 'Guardado a nombre del lector: rechazado')
            sql(f"update office_shares set permission='editor' where document_id='{doc}' and grantee_id='{prof}'")
            t.reload(); ct = config(t)
            check(ct['editorConfig']['mode'] == 'edit' and ct['document']['permissions']['edit'] is True and ct['document']['key'] == cfg2['document']['key'], 'Editor invitado: misma sesión (clave) que el dueño → coedición en tiempo real')
            tc.close()
            xc = new(); x = login(xc, 'estudiante1.b@demo.sematec.test'); x.goto(f'{BASE}/app/oficina/{doc}'); x.wait_for_load_state('networkidle')
            check(x.locator('#oo-stub').count() == 0, 'Otra institución: sin acceso al documento de ONLYOFFICE')
            xc.close()

            # 5. Documento propio → ONLYOFFICE y vuelta atrás
            go(o, f'{BASE}/app/oficina'); o.click('[data-testid=nuevo-doc-blanco]'); o.wait_for_url(re.compile(r'/app/oficina/[0-9a-f-]{36}$'), timeout=20000)
            d2 = o.url.rsplit('/', 1)[1]
            o.wait_for_selector('.ProseMirror'); o.click('.ProseMirror'); o.keyboard.type('Texto para ONLYOFFICE', delay=8)
            until(lambda: o.locator('[data-testid=estado-guardado]').inner_text().startswith('✓'), 15, 'guardado')
            o.once('dialog', lambda dl: dl.accept()); o.click('[data-testid=abrir-onlyoffice]')
            c3 = config(o)
            st, data = http_get(c3['document']['url'])
            text = '\n'.join(p.text for p in docx.Document(io.BytesIO(data)).paragraphs)
            check(c3['document']['fileType'] == 'docx' and 'Texto para ONLYOFFICE' in text, 'Documento propio convertido a DOCX y abierto en ONLYOFFICE')
            o.click('[data-testid=oficina-versiones]'); o.wait_for_selector('[data-testid=lista-versiones] li:has-text("Antes de abrir en ONLYOFFICE")')
            o.once('dialog', lambda dl: dl.accept())
            o.locator('[data-testid=lista-versiones] li', has_text='Antes de abrir en ONLYOFFICE').locator('[data-testid=restaurar-version]').click()
            o.wait_for_selector('.ProseMirror', timeout=30000)
            check('Texto para ONLYOFFICE' in o.locator('.ProseMirror').inner_text(), 'Se puede volver a la versión del editor propio')

            # 6. Copia de un documento de ONLYOFFICE
            go(o, f'{BASE}/app/oficina?v=mios')
            it = o.locator('[data-testid=doc-oficina]', has_text='Notas curso'); it.locator('[data-testid=doc-opciones]').click(); it.locator('[data-testid=doc-duplicar]').click()
            o.wait_for_url(lambda u: re.search(r'/app/oficina/[0-9a-f-]{36}$', u) is not None and not u.endswith(doc), timeout=30000)
            c4 = config(o); copy = o.url.rsplit('/', 1)[1]
            st, data = http_get(c4['document']['url'])
            check(st == 200 and data == edited and sql(f"select content->'oo'->>'path' from office_documents where id='{copy}'").startswith(f'oficina/0a000000-0000-4000-8000-000000000001/{copy}/'), 'Hacer una copia duplica también el archivo de ONLYOFFICE')
            b.close()

        # 7. Sin servidor ONLYOFFICE: se ofrece descargar el original
        restart({})
        with sync_playwright() as pw:
            b = pw.chromium.launch(executable_path=CHROME, headless=True, args=['--no-sandbox'])
            oc = b.new_context(accept_downloads=True); o = login(oc, 'propietario.a@demo.sematec.test', mfa=True)
            go(o, f'{BASE}/app/oficina/{doc}')
            check(o.locator('[data-testid=onlyoffice-inactivo]').count() == 1 and o.locator('[data-testid=descargar-original]').count() == 1, 'Sin ONLYOFFICE activo: aviso claro y descarga del archivo original')
            r = o.request.post(f'{BASE}/api/oficina/onlyoffice/subir', data={'org': '0a000000-0000-4000-8000-000000000001', 'ext': 'docx', 'size': 100})
            check(r.status == 404, 'Las rutas de ONLYOFFICE quedan desactivadas sin configuración')
            b.close()
    finally:
        srv.shutdown()
        subprocess.run(['bash', '/tmp/restart_next.sh'])

    ok = sum(1 for r in results if r[0]); print(f'\n{ok}/{len(results)} verificaciones OK')

if __name__ == '__main__':
    main()
