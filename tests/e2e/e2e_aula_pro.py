"""Etapa 3: aula virtual profesional (sala de espera, bloqueo, temporizador, destacar, subtítulos para todos, salas de grupos,
invitado en espera) y creador de módulos sin código (campos, roles, códigos automáticos, búsqueda, CSV, menú personalizado)."""
import re, sys, os, time
sys.path.insert(0, os.path.dirname(__file__))
from e2e import BASE, CHROME, sql, check, shot, login, status_msg, go, results
from playwright.sync_api import sync_playwright

ORG = '0a000000-0000-4000-8000-000000000001'
SEC = '0a000000-0000-4000-8000-00000000ad01'
T1 = '00000000-0000-4000-8000-000000000020'

def until(fn, timeout=20, msg='condición'):
    end = time.time() + timeout
    while time.time() < end:
        try:
            if fn(): return True
        except Exception: pass
        time.sleep(0.4)
    raise AssertionError(f'Tiempo agotado esperando: {msg}')

sql(f"insert into section_enrollments (organization_id, section_id, student_id, enrollment_id) select '{ORG}', '{SEC}', e.student_id, e.id from enrollments e join students s on s.id = e.student_id where s.organization_id = '{ORG}' and s.user_id is not null on conflict do nothing")
room = sql(f"insert into conference_rooms (organization_id, name, room_type, section_id, max_participants, created_by) values ('{ORG}', 'Aula Pro E2E', 'class', '{SEC}', 50, '{T1}') returning id").splitlines()[0]
sess = sql(f"""set request.jwt.claims = '{{"sub":"{T1}","role":"authenticated"}}'; select create_conference_session('{room}', 'Clase Pro E2E', 'class', now() - interval '5 minutes', now() + interval '55 minutes', 'America/Santiago', true, null)""").splitlines()[-1]

with sync_playwright() as pw:
    b = pw.chromium.launch(executable_path=CHROME, headless=True, args=['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--no-sandbox'])
    new = lambda: b.new_context(viewport={'width': 1440, 'height': 900}, permissions=['camera', 'microphone'])

    # ================= Aula virtual profesional =================
    tc = new(); t = login(tc, 'profesor1.a@demo.sematec.test')
    go(t, f'{BASE}/app/conferencias/sala/{sess}'); t.click('[data-testid=entrar-sala]')
    t.wait_for_selector('.lk-video-conference', timeout=30000)
    for tid in ['boton-anfitrion', 'boton-grupos']:
        check(t.locator(f'[data-testid={tid}]').count() == 1, f'Botón «{tid.replace("boton-", "")}» disponible para el profesor')
    t.click('[data-testid=boton-anfitrion]'); t.wait_for_selector('[data-testid=panel-anfitrion]')
    t.click('[data-testid=toggle-espera]')
    until(lambda: sql(f"select waiting_room from conference_sessions where id = '{sess}'") == 't', msg='sala de espera activa')
    check(True, '⏳ El anfitrión activa la sala de espera')

    ec = new(); e = login(ec, 'estudiante1.a@demo.sematec.test')
    go(e, f'{BASE}/app/conferencias/sala/{sess}'); e.click('[data-testid=entrar-sala]')
    e.wait_for_selector('[data-testid=sala-espera]', timeout=15000)
    check(e.locator('.lk-video-conference').count() == 0, '⏳ El estudiante queda en la sala de espera (no entra solo)')
    t.wait_for_selector('[data-testid=lista-espera] >> text=Estudiante', timeout=15000)
    check(True, '⏳ El anfitrión ve quién está esperando')
    t.locator('[data-testid=lista-espera] [data-testid=admitir]').first.click()
    e.wait_for_selector('.lk-video-conference', timeout=30000)
    check(sql(f"select status from conference_waiting where session_id = '{sess}'") == 'admitted', '✅ El anfitrión lo admite y entra a la clase')

    # Temporizador para todos
    t.fill('[data-testid=panel-anfitrion] input[placeholder^="Ej."]', 'Trabajo individual'); t.click('[data-testid=iniciar-temporizador]')
    e.wait_for_selector('[data-testid=temporizador]:has-text("Trabajo individual")', timeout=15000)
    check(re.search(r'\d:\d\d', e.locator('[data-testid=temporizador]').inner_text()) is not None, '⏱ El estudiante ve la cuenta regresiva del anfitrión')

    # Subtítulos para todos
    if t.locator('[data-testid=boton-subtitulos]').count():
        t.click('[data-testid=cc-todos]')
        until(lambda: 'Quitar subtítulos' in e.locator('[data-testid=boton-subtitulos]').inner_text(), msg='subtítulos activos en el estudiante')
        check(True, '💬 El anfitrión activa los subtítulos en vivo para todos')
        t.click('[data-testid=cc-todos]')
    shot(t, 'aula_pro_anfitrion')

    # Destacar para todos
    t.click('footer button:has-text("Personas")')
    t.wait_for_selector('[data-testid=personas] li:has-text("Estudiante")', timeout=15000)
    t.locator('[data-testid=personas] li:has-text("Estudiante") [data-testid=destacar]').first.click()
    e.wait_for_selector('[data-testid=destacado]', timeout=15000)
    check('Estudiante' in e.locator('[data-testid=destacado]').inner_text(), '⭐ El anfitrión destaca a una persona y todos la ven en grande')
    t.locator('[data-testid=personas] li:has-text("Estudiante") [data-testid=destacar]').first.click()
    e.wait_for_selector('[data-testid=destacado]', state='detached', timeout=15000)
    check(True, '⭐ Y quita el destacado para todos')

    # Bloquear la sala
    t.click('[data-testid=boton-anfitrion]'); t.wait_for_selector('[data-testid=panel-anfitrion]')
    t.click('[data-testid=toggle-bloqueo]')
    until(lambda: sql(f"select locked from conference_sessions where id = '{sess}'") == 't', msg='sala bloqueada')
    e2c = new(); e2 = login(e2c, 'estudiante2.a@demo.sematec.test')
    go(e2, f'{BASE}/app/conferencias/sala/{sess}'); e2.click('[data-testid=entrar-sala]')
    e2.wait_for_selector('text=bloqueó la sala', timeout=15000)
    check(e2.locator('.lk-video-conference').count() == 0, '🔒 Con la sala bloqueada nadie más puede entrar')
    t.click('[data-testid=toggle-bloqueo]')
    until(lambda: sql(f"select locked from conference_sessions where id = '{sess}'") == 'f', msg='sala desbloqueada')
    e2.click('[data-testid=entrar-sala]'); e2.wait_for_selector('[data-testid=sala-espera]', timeout=15000)
    t.wait_for_selector('[data-testid=lista-espera]', timeout=15000)
    t.click('[data-testid=toggle-espera]')   # desactivar la sala de espera deja entrar a todos los que esperaban
    e2.wait_for_selector('.lk-video-conference', timeout=30000)
    check(True, '🔓 Al desbloquear y quitar la sala de espera, los que esperaban entran solos')
    e2c.close()

    # Salas de grupos
    t.click('[data-testid=boton-grupos]'); t.wait_for_selector('[data-testid=panel-grupos]')
    t.wait_for_selector('[data-testid=panel-grupos] select', timeout=15000)
    until(lambda: t.locator('[data-testid=panel-grupos] select').count() == 1, msg='solo queda el estudiante 1 para repartir')
    t.locator('[data-testid=panel-grupos] select').first.select_option('1')
    t.click('[data-testid=abrir-grupos]')
    e.wait_for_selector('[data-testid=en-grupo]:has-text("Grupo 1")', timeout=30000)
    e.wait_for_selector('.lk-video-conference', timeout=30000)
    check(sql(f"select breakout_groups from conference_sessions where id = '{sess}'") == '1', '👥 El anfitrión abre los grupos y el estudiante pasa al Grupo 1')
    t.locator('[data-testid=panel-grupos] button:has-text("Visitar grupo 1")').click()
    t.wait_for_selector('[data-testid=en-grupo]:has-text("Grupo 1")', timeout=30000)
    t.locator('.lk-participant-tile').nth(1).wait_for(timeout=30000)
    check(t.locator('.lk-participant-tile').count() >= 2, '👀 El anfitrión visita el grupo y ve al estudiante')
    t.click('[data-testid=volver-principal]'); t.wait_for_selector('[data-testid=en-grupo]', state='detached', timeout=30000)
    t.wait_for_selector('.lk-video-conference', timeout=30000)
    t.click('[data-testid=boton-grupos]'); t.wait_for_selector('[data-testid=cerrar-grupos]', timeout=15000)
    t.fill('[data-testid=panel-grupos] input[placeholder^="Mensaje"]', 'Quedan 2 minutos'); t.locator('[data-testid=panel-grupos] button:has-text("Enviar")').click()
    e.wait_for_selector('text=Quedan 2 minutos', timeout=15000)
    check(True, '📣 El mensaje del anfitrión llega a todos los grupos')
    t.click('[data-testid=cerrar-grupos]')
    e.wait_for_selector('[data-testid=en-grupo]', state='detached', timeout=30000)
    e.wait_for_selector('.lk-video-conference', timeout=30000)
    check(sql(f"select breakout_groups from conference_sessions where id = '{sess}'") == '0', '↩ Al cerrar los grupos todos vuelven a la sala principal')
    t.locator('.lk-participant-tile').nth(1).wait_for(timeout=30000)
    check(True, '↩ El anfitrión vuelve a ver al estudiante en la sala principal')

    # Invitado externo en sala de espera
    t.click('[data-testid=boton-anfitrion]'); t.wait_for_selector('[data-testid=panel-anfitrion]'); t.click('[data-testid=toggle-espera]')
    until(lambda: sql(f"select waiting_room from conference_sessions where id = '{sess}'") == 't', msg='sala de espera activa')
    t.click('[data-testid=boton-invitar]'); t.click('[data-testid=crear-enlace]')
    t.wait_for_selector('[data-testid=enlace-invitado]', timeout=15000)
    link = t.locator('[data-testid=enlace-invitado]').first.input_value()
    gc = b.new_context(viewport={'width': 1280, 'height': 800}, permissions=['camera', 'microphone']); gp = gc.new_page()
    go(gp, link.replace('http://localhost:3000', BASE))
    gf = gp.locator('[data-testid=form-invitado]')
    gf.locator('input[name=name]').fill('Pedro Externo'); gf.locator('input[name=doc_number]').fill('22222222-2'); gf.locator('input[name=consent]').check()
    gf.locator('button:has-text("Entrar a la sala")').click()
    gp.wait_for_selector('[data-testid=sala-espera]', timeout=15000)
    check(True, '⏳ El invitado externo también espera a ser admitido')
    t.click('[data-testid=boton-anfitrion]'); t.wait_for_selector('[data-testid=lista-espera] >> text=Pedro Externo', timeout=15000)
    t.locator('[data-testid=lista-espera] div:has-text("Pedro Externo") [data-testid=admitir]').last.click()
    gp.wait_for_selector('.lk-video-conference', timeout=30000)
    check(True, '✅ El anfitrión admite al invitado y entra')
    shot(gp, 'aula_pro_invitado')
    gc.close(); ec.close(); tc.close()

    # ================= Creador de módulos sin código =================
    oc = new(); o = login(oc, 'propietario.a@demo.sematec.test', mfa=True)
    go(o, f'{BASE}/app/modulos')
    form = o.locator('form:has(button:has-text("Crear módulo"))')
    form.locator('input[name=name]').fill('Préstamo de equipos')
    form.locator('[data-testid=agregar-campo]').click()
    form.locator('[data-testid=campo]').nth(1).locator('input[aria-label="Nombre del campo"]').fill('Estado')
    form.locator('[data-testid=campo]').nth(1).locator('select').select_option('select')
    form.locator('[data-testid=campo]').nth(1).locator('input[aria-label=Opciones]').fill('Prestado, Devuelto')
    form.locator('[data-testid=agregar-campo]').click()
    form.locator('[data-testid=campo]').nth(2).locator('input[aria-label="Nombre del campo"]').fill('Valor')
    form.locator('[data-testid=campo]').nth(2).locator('select').select_option('money')
    form.locator('input[name=view_roles][value=profesor]').check(); form.locator('input[name=edit_roles][value=profesor]').check()
    form.locator('button:has-text("Crear módulo")').click()
    msg = status_msg(o)
    check('creado' in msg, f'🧩 El propietario crea un módulo nuevo sin tocar el código ({msg})')
    row = sql(f"select slug || '|' || code_prefix || '|' || jsonb_array_length(fields) || '|' || array_to_string(view_roles, ',') from custom_modules where organization_id = '{ORG}' and name = 'Préstamo de equipos'")
    check(row == 'prestamo-de-equipos|PRES|3|profesor', f'🧩 Guarda campos, roles y prefijo automático del código ({row})')
    go(o, f'{BASE}/app/modulos')
    check(o.locator('nav a[href="/app/m/prestamo-de-equipos"]').count() >= 1, '☰ El módulo aparece solo en el menú')

    go(o, f'{BASE}/app/m/prestamo-de-equipos')
    o.fill('input[name=f_nombre]', 'Notebook Lenovo'); o.select_option('select[name=f_estado]', 'Prestado'); o.fill('input[name=f_valor]', '450000')
    o.click('button:has-text("Guardar")'); msg = status_msg(o)
    check('PRES000001' in msg, f'🔢 El registro recibe su código automático de 4 letras + 6 números ({msg})')
    o.fill('input[name=f_nombre]', 'Proyector Epson'); o.select_option('select[name=f_estado]', 'Devuelto'); o.click('button:has-text("Guardar")'); status_msg(o)
    go(o, f'{BASE}/app/m/prestamo-de-equipos')
    txt = o.locator('[data-testid=tabla-registros]').inner_text()
    check('PRES000002' in txt and '$450.000' in txt and 'Prestado' in txt, '📋 La tabla muestra los registros con sus datos y códigos')
    go(o, f'{BASE}/app/m/prestamo-de-equipos?q=epson')
    check(o.locator('[data-testid=registro]').count() == 1 and 'Proyector' in o.locator('[data-testid=tabla-registros]').inner_text(), '🔍 La búsqueda filtra por cualquier dato')
    try:
        sql(f"insert into custom_records (organization_id, module_id, data) select '{ORG}', id, '{{}}' from custom_modules where slug = 'prestamo-de-equipos'")
        bad = False
    except Exception: bad = True
    check(bad, '🛡 La base de datos rechaza un registro sin los campos obligatorios')
    csv = o.request.get(f'{BASE}/app/m/prestamo-de-equipos/csv').text()
    check('PRES000001' in csv and 'Notebook Lenovo' in csv and 'Estado' in csv, '⬇ Descarga a Excel (CSV) con todos los registros')
    # Editar
    o.locator('[data-testid=registro]:has-text("Proyector") summary:has-text("Editar")').click()
    ed = o.locator('[data-testid=registro]:has-text("Proyector") form:has(input[name=id])').first
    ed.locator('input[name=f_nombre]').fill('Proyector Epson X41'); ed.locator('button:has-text("Guardar")').click(); status_msg(o)
    check(sql("select data->>'nombre' from custom_records where code = 'PRES000002'") == 'Proyector Epson X41', '✏ Se edita un registro y conserva su código')

    # Permisos por rol
    pc = new(); p = login(pc, 'profesor1.a@demo.sematec.test')
    check(p.locator('nav a[href="/app/m/prestamo-de-equipos"]').count() >= 1, '👁 El profesor (rol elegido) ve el módulo en su menú')
    go(p, f'{BASE}/app/m/prestamo-de-equipos')
    check(p.locator('button:has-text("Guardar")').count() >= 1, '✏ Y puede agregar registros')
    sc = new(); s = login(sc, 'estudiante1.a@demo.sematec.test')
    check(s.locator('nav a[href="/app/m/prestamo-de-equipos"]').count() == 0, '🔒 El estudiante no ve el módulo en el menú')
    r = s.goto(f'{BASE}/app/m/prestamo-de-equipos')
    check(r.status == 404 and s.locator('[data-testid=tabla-registros]').count() == 0, '🔒 Y no puede abrirlo aunque tenga el enlace')
    check(s.request.get(f'{BASE}/app/m/prestamo-de-equipos/csv').status == 404, '🔒 Tampoco puede descargar sus datos')
    sc.close(); pc.close()

    # Personalizar el menú
    go(o, f'{BASE}/app/modulos')
    o.fill('input[name="label:/app/anuncios"]', 'Novedades'); o.check('input[name=hide][value="/app/encuestas"]')
    o.click('button:has-text("Guardar menú")'); status_msg(o)
    go(o, f'{BASE}/app')
    nav = o.locator('aside nav').first.inner_text()
    check('Novedades' in nav and 'Anuncios' not in nav and 'Encuestas' not in nav, '☰ El propietario renombra y oculta opciones del menú')
    check(o.locator('input[name=hide][value="/app/perfil"]').count() == 0, '☰ «Mi cuenta» y «Módulos y menú» no se pueden ocultar (nunca queda sin acceso)')
    go(o, f'{BASE}/app/modulos')
    o.fill('input[name="label:/app/anuncios"]', ''); o.uncheck('input[name=hide][value="/app/encuestas"]'); o.click('button:has-text("Guardar menú")'); status_msg(o)

    # Editar el módulo: no disponible
    o.locator('[data-testid=modulo]:has-text("Préstamo de equipos") summary:has-text("Editar módulo")').click()
    ef = o.locator('[data-testid=modulo]:has-text("Préstamo de equipos") form:has(button:has-text("Guardar cambios"))')
    ef.locator('input[name=active][type=checkbox]').uncheck(); ef.locator('button:has-text("Guardar cambios")').click(); status_msg(o)
    check(sql("select active from custom_modules where slug = 'prestamo-de-equipos'") == 'f', '🧩 El propietario marca el módulo como «No disponible»')
    pc = new(); p = login(pc, 'profesor1.a@demo.sematec.test')
    check(p.locator('nav a[href="/app/m/prestamo-de-equipos"]').count() == 0, '🔒 Un módulo no disponible desaparece para los demás')
    pc.close()
    shot(o, 'modulos_propietario')
    oc.close()

ok = sum(1 for r in results if r[0]); print(f'\n{ok}/{len(results)} verificaciones OK')
