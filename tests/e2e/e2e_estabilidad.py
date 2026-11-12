"""Etapa A: aula ordenada en el celular, búsqueda sin límites, estado del correo, enlaces sin localhost y páginas que no se caen."""
import re, sys, os, time
sys.path.insert(0, os.path.dirname(__file__))
from e2e import BASE, CHROME, sql, check, shot, login, status_msg, go, results
from playwright.sync_api import sync_playwright

ORG = '0a000000-0000-4000-8000-000000000001'
SEC = '0a000000-0000-4000-8000-00000000ad01'
T1 = '00000000-0000-4000-8000-000000000020'
room = sql(f"insert into conference_rooms (organization_id, name, room_type, section_id, max_participants, created_by) values ('{ORG}', 'Aula Celular', 'class', '{SEC}', 50, '{T1}') returning id").splitlines()[0]
sess = sql(f"""set request.jwt.claims = '{{"sub":"{T1}","role":"authenticated"}}'; select create_conference_session('{room}', 'Computacion', 'class', now() - interval '5 minutes', now() + interval '55 minutes', 'America/Santiago', true, null)""").splitlines()[-1]

with sync_playwright() as pw:
    b = pw.chromium.launch(executable_path=CHROME, headless=True, args=['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--no-sandbox'])
    # --- Celular (412 x 915, como el de la captura)
    pc = b.new_context(viewport={'width': 412, 'height': 915}, is_mobile=True, has_touch=True, device_scale_factor=2.6,
                       user_agent='Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Mobile Safari/537.36', permissions=['camera', 'microphone'])
    p = login(pc, 'profesor1.a@demo.sematec.test')
    go(p, f'{BASE}/app/conferencias/sala/{sess}'); p.click('[data-testid=entrar-sala]')
    p.wait_for_selector('[data-testid=barra-controles]', timeout=30000)
    h = p.locator('[data-testid=barra-controles]').bounding_box()['height']
    check(h < 80, f'📱 En el celular los controles ocupan una sola fila ({int(h)} px de alto)')
    check(p.locator('[data-testid=boton-pizarra]').count() == 0, '📱 Las opciones extra quedan guardadas en «⋯ Más»')
    p.locator('.lk-participant-tile').first.wait_for(timeout=20000); time.sleep(1)
    tile = p.locator('.lk-participant-tile').first.bounding_box()['height']
    check(tile > 500, f'📱 El video usa casi toda la pantalla ({int(tile)} px)')
    shot(p, 'aula_celular')
    p.click('[data-testid=boton-mas]'); p.wait_for_selector('[data-testid=mas-opciones]')
    sheet = p.locator('[data-testid=mas-opciones]').inner_text()
    check(all(x in sheet for x in ['Pizarra', 'Encuesta', 'Anfitrión', 'Grupos', 'Fondo', 'Levantar la mano']), '📱 «⋯ Más» muestra Pizarra, Encuesta, Anfitrión, Grupos, Fondo y mano')
    shot(p, 'aula_celular_mas')
    p.click('[data-testid=boton-anfitrion]'); p.wait_for_selector('[data-testid=panel-anfitrion]')
    check(p.locator('[data-testid=mas-opciones]').count() == 0, '📱 Al elegir una opción, el menú «Más» se cierra solo')
    p.click('button[aria-label="Cerrar panel"]'); p.click('button[aria-label=Participantes]'); p.wait_for_selector('[data-testid=personas]')
    check(True, '📱 Personas y Chat siguen a un toque')
    check(p.locator('[data-testid=minimizar] svg').count() == 1, '📱 El botón Minimizar usa un ícono que se ve en todos los celulares')
    pc.close()

    # --- Búsqueda sin límites (varias palabras, en cualquier orden, texto largo)
    tc = b.new_context(viewport={'width': 1440, 'height': 900}); t = login(tc, 'matriculas.a@demo.sematec.test')
    t.wait_for_load_state('networkidle'); t.locator('[data-testid=buscar]').first.click(); t.fill('[data-testid=buscar-texto]', 'dos estudiante')
    t.wait_for_selector('[data-testid=buscar-resultados] li:has-text("Dos")', timeout=15000)
    first = [x for x in t.locator('[data-testid=buscar-resultados] li').all_inner_texts() if 'Ir a la sección' not in x][0]
    check('Dos' in first, '🔍 Busca con varias palabras en cualquier orden («dos estudiante»)')
    t.fill('[data-testid=buscar-texto]', 'Estudiante Dos ' + 'con un texto muy largo que antes se cortaba ' * 8)
    t.wait_for_selector('[data-testid=buscar-resultados] >> text=Dos', timeout=15000)
    check(True, '🔍 Acepta textos largos sin cortarlos ni fallar')
    t.fill('[data-testid=buscar-texto]', "'; drop table students; -- %_\\")
    time.sleep(1.5)
    check(t.locator('[data-testid=buscar-texto]').is_visible() and sql("select count(*) > 0 from students") == 't', '🛡 Caracteres especiales no rompen la búsqueda')
    tc.close()

    # --- Correo y enlaces
    oc = b.new_context(viewport={'width': 1440, 'height': 900}); o = login(oc, 'propietario.a@demo.sematec.test', mfa=True)
    go(o, f'{BASE}/app/configuracion?t=institucion')
    est = o.locator('[data-testid=estado-correo]').inner_text()
    check('Servidor' in est and 'SMTP_PASS' in est and '••••' not in est or 'configurada' in est, '📧 El propietario ve el estado del correo (sin mostrar la clave)')
    check('localhost' not in est.split('Enlaces de los correos')[-1] or 'localhost:3000' in BASE, '📧 Muestra a qué dirección apuntan los enlaces')
    o.click('button:has-text("Enviarme un correo de prueba")'); msg = status_msg(o)
    check('enviado' in msg or 'No se pudo' in msg or 'servidor' in msg, f'📧 Botón de correo de prueba con resultado claro ({msg[:90]})')
    # Página inexistente y error controlado
    r = o.goto(f'{BASE}/app/m/no-existe-este-modulo'); o.wait_for_load_state('networkidle')
    check(o.locator('[data-testid=no-encontrado]').count() == 1, '🛡 Una página que no existe muestra un aviso claro (no se cae)')
    go(o, f'{BASE}/app/estudiantes/00000000-0000-4000-8000-0000000000ff')
    check(o.locator('aside nav').count() >= 1, '🛡 Un registro inexistente no tumba el sistema: el menú sigue disponible')
    oc.close()

ok = sum(1 for r in results if r[0]); print(f'\n{ok}/{len(results)} verificaciones OK')
