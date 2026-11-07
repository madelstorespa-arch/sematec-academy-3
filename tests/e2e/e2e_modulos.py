"""Anuncios, mensajes, biblioteca, soporte y cuenta automática al matricular."""
import re, sys, os
sys.path.insert(0, os.path.dirname(__file__))
from e2e import BASE, CHROME, sql, check, shot, login, status_msg, go, sel_re, results
from playwright.sync_api import sync_playwright

SEC, EST = 'secretaria.a@demo.sematec.test', 'estudiante1.a@demo.sematec.test'
with sync_playwright() as pw:
    b = pw.chromium.launch(executable_path=CHROME, headless=True, args=['--no-sandbox'])
    sc = b.new_context(viewport={'width': 1366, 'height': 900}); s = login(sc, SEC)
    # Anuncio
    go(s, BASE + '/app/anuncios'); s.click('summary:has-text("Publicar anuncio")')
    s.fill('input[name=title]', 'Inicio de clases E2E'); s.fill('textarea[name=body]', 'Las clases comienzan el lunes 9:00.')
    s.select_option('select[name=audience]', 'students'); s.click('button:has-text("Publicar")')
    check('publicado' in status_msg(s), 'Secretaría publica un anuncio para estudiantes')
    # Biblioteca
    go(s, BASE + '/app/biblioteca'); s.click('summary:has-text("Agregar material")')
    s.fill('input[name=title]', 'Bases de Datos E2E'); s.fill('input[name=author]', 'Elmasri'); s.fill('input[name=copies]', '2')
    s.click('button:has-text("Agregar")'); check('catálogo' in status_msg(s), 'Material agregado a la biblioteca')
    go(s, BASE + '/app/biblioteca'); s.click('summary:has-text("Registrar préstamo")')
    sel_re(s, 'select[name=item_id]', 'Bases de Datos E2E'); sel_re(s, 'select[name=borrower_id]', 'estudiante1')
    s.click('button:has-text("Prestar")'); check('registrado' in status_msg(s), 'Préstamo registrado')
    check(sql("select available_copies from library_items where title='Bases de Datos E2E'") == '1', 'Ejemplares disponibles se descuentan')
    shot(s, 'mod_biblioteca')
    # Cuenta automática al matricular
    go(s, BASE + '/app/estudiantes?nuevo=1')
    s.fill('input[name=student_code]', 'E2E-AUTO'); s.fill('input[name=first_names]', 'Nueva'); s.fill('input[name=last_names]', 'Alumna')
    s.locator('select[name=campus_id]').select_option(index=1); s.fill('input[name=id_document_number]', 'AUTO-1'); s.fill('input[name=email]', 'nueva.alumna@demo.sematec.test')
    s.click('button:has-text("Registrar estudiante")'); status_msg(s)
    go(s, BASE + '/app/matriculas'); sel_re(s, 'select[name=student_id]', 'Alumna'); sel_re(s, 'select[name=program_id]', 'Informática')
    s.locator('select[name=period_id]').select_option(index=1); s.click('button:has-text("Matricular")')
    msg = status_msg(s); print('   ', msg[:160])
    check('contraseña temporal' in msg, 'Al matricular se crea la cuenta y la contraseña automáticamente')
    pw_tmp = re.search(r'vez\): (\S+)', msg).group(1)
    nc = b.new_context(); n = nc.new_page(); go(n, BASE + '/login')
    n.fill('input[name=email]', 'nueva.alumna@demo.sematec.test'); n.fill('input[name=password]', pw_tmp); n.click('button[type=submit]')
    n.wait_for_url(re.compile(r'/app'), timeout=20000); check('/app' in n.url, 'El estudiante matriculado entra con su contraseña temporal'); nc.close()
    # Estudiante
    ec = b.new_context(viewport={'width': 390, 'height': 844}, is_mobile=True); e = login(ec, EST)
    go(e, BASE + '/app/anuncios'); check(e.locator('text=Inicio de clases E2E').count() == 1, 'Estudiante ve el anuncio'); shot(e, 'mod_anuncios_celular')
    go(e, BASE + '/app/biblioteca'); check(e.locator('text=Bases de Datos E2E').count() >= 1, 'Estudiante ve su préstamo y el catálogo')
    go(e, BASE + '/app/mensajes'); e.click('summary:has-text("Nuevo mensaje")'); sel_re(e, 'select[name=recipient_id]', 'Secretaria')
    e.fill('input[name=subject]', 'Consulta horario E2E'); e.fill('textarea[name=body]', '¿A qué hora es la clase?'); e.click('button:has-text("Enviar")')
    check('enviado' in status_msg(e), 'Estudiante envía mensaje a secretaría')
    check(e.locator('select[name=recipient_id] option:has-text("Estudiante Dos")').count() == 0, 'Estudiante no puede ver la lista de otros estudiantes')
    go(e, BASE + '/app/soporte'); 
    if e.locator('input[name=subject]').count() == 0 or not e.locator('input[name=subject]').is_visible(): e.click('summary:has-text("Nueva solicitud")')
    e.fill('input[name=subject]', 'No veo mi aula E2E'); e.fill('textarea[name=body]', 'Al entrar sale un error.'); e.click('button:has-text("Enviar solicitud")')
    e.wait_for_url(re.compile(r'/app/soporte/'), timeout=20000); check(e.locator('text=Al entrar sale un error.').count() == 1, 'Estudiante abre ticket de soporte')
    ticket_url = e.url
    # Secretaría responde
    go(s, BASE + '/app/mensajes'); check(s.locator('text=Consulta horario E2E').count() == 1, 'Secretaría recibe el mensaje')
    s.click('text=Consulta horario E2E'); s.fill('textarea[name=body]', 'A las 9:00.'); s.click('button:has-text("Enviar respuesta")')
    check('enviado' in status_msg(s), 'Secretaría responde el mensaje')
    go(s, ticket_url); s.fill('textarea[name=body]', 'Ya está solucionado, recargue la página.'); s.click('button:has-text("Enviar")'); status_msg(s)
    s.select_option('select[name=status]', 'resuelto'); s.click('button:has-text("Actualizar")'); s.wait_for_selector('text=Ticket actualizado', timeout=20000); check(True, 'Soporte responde y marca resuelto')
    go(e, ticket_url); check(e.locator('text=Ya está solucionado').count() == 1, 'Estudiante ve la respuesta de soporte'); shot(e, 'mod_soporte_celular')
    go(e, BASE + '/app/mensajes'); check(e.locator('text=Re: Consulta horario E2E').count() == 1, 'Estudiante recibe la respuesta')
    b.close()
print(f"\n{sum(1 for ok, _ in results if ok)}/{len(results)} pruebas OK")
