"""📱 App SEMATEC Aula (Android): permiso seguro para compartir la pantalla del celular, botón en la clase, puente con la app y página de descarga."""
import re, sys, os, json, base64, time
sys.path.insert(0, os.path.dirname(__file__))
from e2e import BASE, CHROME, sql, check, login, results
from playwright.sync_api import sync_playwright

ORG = '0a000000-0000-4000-8000-000000000001'
SEC = '0a000000-0000-4000-8000-00000000ad01'
T1 = '00000000-0000-4000-8000-000000000020'
ANDROID = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Mobile Safari/537.36'
sql(f"insert into section_enrollments (organization_id, section_id, student_id, enrollment_id) select '{ORG}', '{SEC}', e.student_id, e.id from enrollments e join students s on s.id = e.student_id where s.organization_id = '{ORG}' and s.user_id is not null on conflict do nothing")
room = sql(f"insert into conference_rooms (organization_id, name, room_type, section_id, max_participants, created_by) values ('{ORG}', 'Aula App Android', 'class', '{SEC}', 50, '{T1}') returning id").splitlines()[0]
sess = sql(f"""set request.jwt.claims = '{{"sub":"{T1}","role":"authenticated"}}'; select create_conference_session('{room}', 'Clase con celular', 'class', now() - interval '5 minutes', now() + interval '55 minutes', 'America/Santiago', false, null)""").splitlines()[-1]

def go(page, url): page.goto(url); page.wait_for_load_state('load')
def enter(p):
    go(p, f'{BASE}/app/conferencias/sala/{sess}'); p.click('button:has-text("Entrar a la sala")'); p.wait_for_selector('.lk-video-conference', timeout=30000)
def jwt(tok):
    part = tok.split('.')[1]; part += '=' * (-len(part) % 4)
    return json.loads(base64.urlsafe_b64decode(part))
def pantalla(page):
    r = page.request.post(f'{BASE}/api/livekit/pantalla', data=json.dumps({'session': sess}), headers={'Content-Type': 'application/json'})
    return r.status, r.json()

with sync_playwright() as pw:
    b = pw.chromium.launch(executable_path=CHROME, headless=True, args=['--no-sandbox'])
    phone = lambda ua=ANDROID: b.new_context(viewport={'width': 412, 'height': 915}, is_mobile=True, has_touch=True, permissions=['camera', 'microphone'], user_agent=ua)

    # ---------- Página de descarga ----------
    dc = phone(); d = dc.new_page(); go(d, f'{BASE}/descargar')
    href = d.locator('[data-testid=descargar-apk]').get_attribute('href')
    check(href.endswith('/releases/download/app-android/sematec-aula.apk') and href.startswith('https://github.com/'), '⬇ La página /descargar entrega la app compilada por GitHub')
    check(d.locator('[data-testid=abrir-en-app]').get_attribute('href').startswith('sematecaula://abrir?site='), '🔗 «Abrir esta plataforma en la app» configura la app con la dirección de la plataforma')
    check('iPhone' in d.locator('[data-testid=pagina-descarga]').inner_text(), '🍎 Explica la limitación de iPhone/iPad')
    r = d.request.post(f'{BASE}/api/livekit/pantalla', data=json.dumps({'session': sess}), headers={'Content-Type': 'application/json'})
    check(r.status == 401, '🔒 Sin sesión no se entrega ningún permiso de pantalla')
    dc.close()

    # ---------- Permiso de pantalla (token) ----------
    tc = phone(); t = login(tc, 'profesor1.a@demo.sematec.test')
    st, j = pantalla(t)
    claims = jwt(j.get('token', 'a.e30.b'))
    v = claims.get('video', {})
    check(st == 200 and claims.get('sub') == f'pan_{T1}' and v.get('canSubscribe') is False and sorted(v.get('canPublishSources', [])) == ['screen_share', 'screen_share_audio'],
          '🎫 El profesor recibe un permiso que SOLO publica su pantalla (no ve ni escucha: eso lo hace su navegador)')
    check(claims['exp'] - time.time() <= 905 and j['url'].startswith('ws'), '⏱ El permiso para entrar vence en 15 minutos')

    sql(f"update conference_sessions set students_can_share = false where id = '{sess}'")
    ec = phone(); e = login(ec, 'estudiante1.a@demo.sematec.test')
    st, j = pantalla(e)
    check(st == 403 and 'no permite compartir' in j.get('error', ''), '⛔ Un estudiante no recibe permiso si el profesor no permite compartir pantalla')
    sql(f"update conference_sessions set students_can_share = true where id = '{sess}'")
    st, j = pantalla(e)
    check(st == 200, '✅ Cuando el profesor lo permite, el estudiante también puede compartir con la app')
    sql(f"update conference_sessions set room_policy = room_policy || '{{\"share\": false}}' where id = '{sess}'")
    st, j = pantalla(e)
    check(st == 403, '⚙ La configuración de la sala («no compartir pantalla») también aplica a la app')
    sql(f"update conference_sessions set room_policy = room_policy - 'share', students_can_share = false where id = '{sess}'")
    ec.close()

    # ---------- Botón en la clase (navegador Android, sin la app) ----------
    enter(t)
    t.click('[data-testid=boton-mas]'); t.click('[data-testid=compartir-celular]')
    t.wait_for_selector('[data-testid=compartir-app]')
    check('Descargue la app' in t.locator('[data-testid=ayuda-compartir]').inner_text(), '📲 En Android la clase ofrece «Compartir con la app SEMATEC Aula» y el enlace para descargarla')
    t.click('[data-testid=compartir-app]')
    t.wait_for_function("() => document.querySelector('[data-testid=descargar-app]')?.innerText.includes('No se abrió')", timeout=15000)
    check(True, '🧭 Si la app no está instalada, lo dice y ofrece descargarla')
    tc.close()

    # ---------- Dentro de la app (puente seguro) ----------
    ac = phone(ANDROID + ' SematecAula/1.0.5')
    ac.add_init_script("window.SematecAula = { postMessage: (m) => { window.__app = JSON.parse(m); } };")
    a = login(ac, 'profesor1.a@demo.sematec.test'); enter(a)
    a.click('[data-testid=boton-mas]'); a.click('[data-testid=compartir-celular]')
    check(a.locator('[data-testid=descargar-app]').count() == 0, '📱 Dentro de la app no se pide descargarla')
    a.click('[data-testid=compartir-app]')
    a.wait_for_function('() => !!window.__app', timeout=15000)
    msg = a.evaluate('window.__app')
    check(msg['action'] == 'share' and jwt(msg['token'])['sub'] == f'pan_{T1}' and msg['title'] == 'Clase con celular',
          '🤝 La página entrega el permiso a la app por el puente (solo la página principal de la plataforma)')
    ac.close()
    b.close()

ok = sum(1 for r in results if r[0]); print(f'\n{ok}/{len(results)} verificaciones OK')
