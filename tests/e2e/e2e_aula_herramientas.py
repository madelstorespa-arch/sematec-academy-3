"""Aula pro, etapa 1: configuración de la sala aplicada en el servidor, herramientas (notas, preguntas, apps, enlaces,
sorteo, privados, asistencia), mis ajustes, atajos, opciones al compartir pantalla y celulares Android."""
import re, sys, os, time, json, base64
sys.path.insert(0, os.path.dirname(__file__))
from e2e import BASE, CHROME, sql, check, login, results
from playwright.sync_api import sync_playwright

ORG = '0a000000-0000-4000-8000-000000000001'
SEC = '0a000000-0000-4000-8000-00000000ad01'
T1 = '00000000-0000-4000-8000-000000000020'
sql(f"insert into section_enrollments (organization_id, section_id, student_id, enrollment_id) select '{ORG}', '{SEC}', e.student_id, e.id from enrollments e join students s on s.id = e.student_id where s.organization_id = '{ORG}' and s.user_id is not null on conflict do nothing")
room = sql(f"insert into conference_rooms (organization_id, name, room_type, section_id, max_participants, created_by) values ('{ORG}', 'Aula Herramientas', 'class', '{SEC}', 50, '{T1}') returning id").splitlines()[0]
sess = sql(f"""set request.jwt.claims = '{{"sub":"{T1}","role":"authenticated"}}'; select create_conference_session('{room}', 'Clase con herramientas', 'class', now() - interval '5 minutes', now() + interval '55 minutes', 'America/Santiago', true, null)""").splitlines()[-1]

def go(page, url): page.goto(url); page.wait_for_load_state('load')
def enter(p):
    go(p, f'{BASE}/app/conferencias/sala/{sess}'); p.click('[data-testid=entrar-sala]'); p.wait_for_selector('.lk-video-conference', timeout=30000)
def until(fn, timeout=20, msg=''):
    end = time.time() + timeout
    while time.time() < end:
        try:
            if fn(): return True
        except Exception: pass
        time.sleep(0.4)
    raise AssertionError('Tiempo agotado: ' + msg)
def token_sources(page):
    r = page.request.post(f'{BASE}/api/livekit/token', data={'session': sess}); tok = r.json()['token'].split('.')[1]
    return json.loads(base64.urlsafe_b64decode(tok + '=' * (-len(tok) % 4)))['video'].get('canPublishSources', [])
def tool(p, name):
    if p.locator('[data-testid=herramientas]').count() == 0: p.click('[data-testid=boton-herramientas]')
    p.locator(f'[data-testid=herramientas] button:has-text("{name}")').click()

with sync_playwright() as pw:
    b = pw.chromium.launch(executable_path=CHROME, headless=True, args=['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--auto-accept-this-tab-capture', '--no-sandbox'])
    ctx = lambda: b.new_context(viewport={'width': 1440, 'height': 900}, permissions=['camera', 'microphone'])
    tc = ctx(); t = login(tc, 'profesor1.a@demo.sematec.test'); ec = ctx(); e = login(ec, 'estudiante1.a@demo.sematec.test')
    enter(t); enter(e)
    until(lambda: '2 👥' in t.locator('header').first.inner_text() and '2 👥' in e.locator('header').first.inner_text(), msg='ambos conectados')
    check(t.locator('[data-testid=conexion]').count() == 1, '📶 Indicador de calidad de conexión')

    # ---------- Herramientas ----------
    t.keyboard.press('Alt+h'); t.wait_for_selector('[data-testid=herramientas]')
    hub = t.locator('[data-testid=herramientas]').inner_text()
    check(all(x in hub for x in ['Mis ajustes', 'Notas compartidas', 'Preguntas y respuestas', 'Apps y enlaces', 'Ventana flotante', 'Elegir al azar', 'Asistencia', 'Configuración de la sala']),
          '🧰 Herramientas: ajustes, notas, preguntas, apps, ventana flotante, sorteo, asistencia y configuración (atajo Alt+H)')
    e.click('[data-testid=boton-herramientas]')
    eh = e.locator('[data-testid=herramientas]').inner_text()
    check('Notas compartidas' in eh and 'Configuración de la sala' not in eh and 'Asistencia' not in eh, '🔒 El estudiante no ve las herramientas del anfitrión')

    # Notas compartidas
    tool(t, 'Notas compartidas'); t.fill('[data-testid=notas-texto]', 'Tarea: leer el capítulo 3 y traer ejemplos.')
    tool(e, 'Notas compartidas'); until(lambda: 'capítulo 3' in e.locator('[data-testid=notas-texto]').input_value(), msg='notas')
    check(True, '📝 Notas compartidas: lo que escribe el profesor aparece al instante a todos')
    t.locator('[data-testid=notas] input[type=checkbox]').check(); until(lambda: e.locator('[data-testid=notas-texto]').get_attribute('readonly') is not None, msg='bloqueo notas')
    check(True, '📝 El anfitrión puede dejar las notas «solo lectura» para los demás')

    # Preguntas y respuestas
    e.click('text=← Herramientas'); tool(e, 'Preguntas y respuestas')
    e.fill('[data-testid=preguntas] textarea', '¿Entra el capítulo 4 en la prueba?'); e.locator('[data-testid=preguntas] input[type=checkbox]').check(); e.click('[data-testid=preguntas] button:has-text("Preguntar")')
    t.click('text=← Herramientas'); tool(t, 'Preguntas y respuestas')
    until(lambda: 'capítulo 4' in t.locator('[data-testid=preguntas]').inner_text(), msg='pregunta')
    check('Anónimo' in t.locator('[data-testid=pregunta]').first.inner_text(), '❓ El estudiante pregunta (anónimo) y el profesor la ve')
    t.locator('[data-testid=votar]').first.click(); until(lambda: '👍 1' in e.locator('[data-testid=pregunta]').first.inner_text(), msg='voto')
    t.locator('[data-testid=pregunta] button:has-text("Respondida")').first.click(); until(lambda: 'respondida' in e.locator('[data-testid=pregunta]').first.inner_text(), msg='respondida')
    check(True, '❓ Votos y «respondida» se ven en todos los equipos')

    # Apps dentro de la clase
    t.click('text=← Herramientas'); tool(t, 'Apps y enlaces')
    t.fill('[data-testid=app-url]', 'https://www.youtube.com/watch?v=dQw4w9WgXcQ'); t.click('[data-testid=compartir-app]')
    e.wait_for_selector('[data-testid=app-en-clase] iframe', timeout=15000)
    check('youtube-nocookie.com/embed/dQw4w9WgXcQ' in e.locator('[data-testid=app-en-clase] iframe').get_attribute('src'), '📱 El profesor abre un video de YouTube DENTRO de la clase para todos')
    t.click('[data-testid=cerrar-app]'); e.wait_for_selector('[data-testid=app-en-clase]', state='detached', timeout=15000)
    t.fill('[data-testid=app-url]', 'https://docs.google.com/presentation/d/1AbCdEfGhIjKlMnOp/edit#slide=id.p'); t.click('[data-testid=compartir-app]')
    e.wait_for_selector('[data-testid=app-en-clase] iframe', timeout=15000)
    check('/presentation/d/1AbCdEfGhIjKlMnOp/embed' in e.locator('[data-testid=app-en-clase] iframe').get_attribute('src'), '📊 Google Slides se muestra en modo presentación dentro de la clase')
    t.click('[data-testid=cerrar-app]')
    t.fill('[data-testid=app-url]', 'https://es.wikipedia.org/wiki/Chile'); t.click('[data-testid=compartir-app]')
    e.wait_for_selector('[data-testid=enlace-compartido]', timeout=15000)
    check(e.locator('[data-testid=enlace-compartido] a').get_attribute('href') == 'https://es.wikipedia.org/wiki/Chile', '🔗 Un sitio que no permite mostrarse dentro llega como botón «Abrir» a todos')

    # Sorteo
    t.click('text=← Herramientas'); t.locator('[data-testid=herramientas] button:has-text("Elegir al azar")').click()
    e.wait_for_selector('[data-testid=elegido]', timeout=15000)
    check('Le toca a' in e.locator('[data-testid=elegido]').inner_text(), '🎲 Elegir al azar: todos ven a quién le toca')

    # Mensaje privado
    e.click('footer button:has-text("Personas")'); e.locator('[data-testid=personas] li:has-text("Profesor") [data-testid=privado]').first.click()
    e.fill('[data-testid=privado-texto]', 'Profe, ¿puedo salir 5 minutos?'); e.click('[data-testid=personas] button:has-text("Enviar")')
    t.click('footer button:has-text("Chat")'); t.wait_for_selector('[data-testid=privados] >> text=puedo salir', timeout=15000)
    check(e.locator('[data-testid=chat-mensajes] >> text=puedo salir').count() == 0, '✉ Mensaje privado: solo lo ve el destinatario (no aparece en el chat general)')

    # Asistencia
    t.click('[data-testid=boton-herramientas]'); tool(t, 'Asistencia')
    check('Estudiante' in t.locator('[data-testid=asistencia]').inner_text(), '📋 Asistencia: quién está ahora y botón para descargarla')

    # ---------- Configuración de la sala (servidor) ----------
    t.click('text=← Herramientas'); tool(t, 'Configuración de la sala')
    until(lambda: t.locator('[data-testid=politica-mic]').is_enabled(), msg='listo'); t.locator('[data-testid=politica-mic]').click(); until(lambda: sql(f"select room_policy->>'mic' from conference_sessions where id = '{sess}'") == 'false', msg='politica mic')
    until(lambda: t.locator('[data-testid=politica-chat]').is_enabled(), msg='listo'); t.locator('[data-testid=politica-chat]').click(); until(lambda: sql(f"select room_policy->>'chat' from conference_sessions where id = '{sess}'") == 'false', msg='politica chat')
    src = token_sources(e)
    check('MICROPHONE' not in [str(x).upper() for x in src] and 'microphone' not in src and 1 not in src and 2 not in src or len(src) == 1, f'⚙ Micrófonos apagados: el servidor de video ya no deja hablar a los participantes ({src})')
    check(len(token_sources(t)) >= 3, '⚙ El anfitrión sigue pudiendo hablar y compartir')
    e.click('footer button:has-text("Chat")'); until(lambda: e.locator('text=desactivó el chat').count() > 0, msg='chat off')
    check(True, '💬 Chat desactivado para los participantes al instante')
    until(lambda: t.locator('[data-testid=politica-mic]').is_enabled(), msg='listo'); t.locator('[data-testid=politica-mic]').click(); until(lambda: sql(f"select room_policy->>'mic' from conference_sessions where id = '{sess}'") == 'true', msg='mic'); until(lambda: t.locator('[data-testid=politica-chat]').is_enabled(), msg='listo'); t.locator('[data-testid=politica-chat]').click()
    until(lambda: sql(f"select concat(room_policy->>'mic', room_policy->>'chat') from conference_sessions where id = '{sess}'") == 'truetrue', timeout=45, msg='restaurar')

    # ---------- Mis ajustes ----------
    e.click('[data-testid=boton-herramientas]'); tool(e, 'Mis ajustes')
    check('parlante' in e.locator('[data-testid=mis-ajustes]').inner_text().lower(), '🎛 Mis ajustes: micrófono, cámara y parlante')
    e.select_option('[data-testid=ajuste-calidad]', 'low'); e.locator('[data-testid=ajuste-mirror]').uncheck()
    saved = json.loads(e.evaluate("localStorage.getItem('sematec-aula-ajustes')"))
    check(saved['quality'] == 'low' and saved['mirror'] is False, '🎛 Ahorro de datos y espejo se guardan en el equipo de cada persona')
    check(e.locator('.sin-espejo').count() == 1, '🎛 Quitar el espejo cambia solo la vista propia')

    # ---------- Compartir pantalla: ocultar videos ----------
    t.locator('footer button:has-text("Compartir pantalla")').click()
    check(t.locator('[data-testid=ocultar-mi-video]').count() == 1, '🖥 Al compartir: opción «Ocultar mi video mientras comparto»')
    t.locator('[data-testid=ocultar-mi-video]').check(); t.locator('button:has-text("Elegir qué compartir")').click()
    t.wait_for_selector('[data-testid=compartiendo]', timeout=20000)
    check(t.locator('[data-testid=ver-mi-pantalla]').count() == 1, '🖥 El presentador no ve su propia pantalla repetida (puede activarla si quiere)')
    e.wait_for_selector('[data-testid=solo-pantalla]', timeout=20000)
    e.click('[data-testid=solo-pantalla]'); until(lambda: e.locator('.lk-carousel').count() == 0, msg='solo pantalla')
    check(True, '🙈 El estudiante oculta los videos y ve solo la pantalla compartida')
    t.locator('[data-testid=dejar-compartir]').click()
    tc.close(); ec.close()

    # ---------- Celular Android ----------
    mc = b.new_context(viewport={'width': 412, 'height': 915}, is_mobile=True, has_touch=True, permissions=['camera', 'microphone'],
                       user_agent='Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Mobile Safari/537.36')
    m = login(mc, 'profesor1.a@demo.sematec.test'); enter(m)
    m.click('[data-testid=boton-mas]')
    check(m.locator('[data-testid=compartir-celular]').count() == 1, '📱 En Android se ofrecen las alternativas para compartir (el navegador no lo permite)')
    check(m.locator('[data-testid=flotante]').count() == 1, '⧉ En el celular también está la ventana flotante para usar otras apps sin salir')
    mc.close()

ok = sum(1 for r in results if r[0]); print(f'\n{ok}/{len(results)} verificaciones OK')
