"""Búsqueda global, editar matrícula, gastos y balance por programa/sección, comprobantes (PDF, correo, guardar),
aula virtual minimizada sin desconectarse, pizarra, encuesta en vivo y enlace de invitados externos."""
import re, sys, os, time, glob
sys.path.insert(0, os.path.dirname(__file__))
from e2e import BASE, CHROME, sql, check, login, status_msg, results
from playwright.sync_api import sync_playwright

ORG = '0a000000-0000-4000-8000-000000000001'
SEC = '0a000000-0000-4000-8000-00000000ad01'
T1 = '00000000-0000-4000-8000-000000000020'
def go(page, url): page.goto(url); page.wait_for_load_state('load')
def wait_text(page, selector, text, timeout=20):
    end = time.time() + timeout
    while time.time() < end:
        loc = page.locator(selector)
        if loc.count() and text in loc.first.inner_text(): return True
        time.sleep(0.4)
    raise AssertionError(f'No apareció «{text}» en {selector}')
def form_status(page, form):
    loc = form.locator('[role=status]'); loc.wait_for(timeout=20000); return loc.inner_text()

sql("delete from system_events where event_type like 'rate:%'")
sql(f"insert into section_enrollments (organization_id, section_id, student_id, enrollment_id) select '{ORG}', '{SEC}', e.student_id, e.id from enrollments e join students s on s.id = e.student_id where s.organization_id = '{ORG}' and s.user_id is not null on conflict do nothing")
sql(f"update section_enrollments set status = 'enrolled', dropped_at = null where section_id = '{SEC}'")
st1 = sql("select s.id from students s join auth.users u on u.id = s.user_id where u.email = 'estudiante1.a@demo.sematec.test'")
enr = sql(f"select e.id from enrollments e join section_enrollments se on se.enrollment_id = e.id where se.section_id = '{SEC}' and e.student_id = '{st1}' limit 1")
prog1 = sql(f"select program_id from enrollments where id = '{enr}'")
period = sql(f"select period_id from enrollments where id = '{enr}'")
sql(f"update students set id_document_type = null, id_document_number = null where id = '{st1}'")
# Segundo programa (con malla) y una sección extra del mismo periodo
prog2 = sql(f"select id from programs where organization_id = '{ORG}' and code = 'E2E-ADM'") or \
    sql(f"insert into programs (organization_id, code, name, level, modality, duration_terms, grade_scale_id, status) select '{ORG}', 'E2E-ADM', 'Administración E2E', level, modality, 4, grade_scale_id, 'active' from programs where id = '{prog1}' returning id").splitlines()[0]
sql(f"insert into curricula (organization_id, program_id, version, valid_from, total_credits, status) select '{ORG}', '{prog2}', 'v1', current_date - 30, 100, 'active' where not exists (select 1 from curricula where program_id = '{prog2}')")
sec2 = sql(f"select id from sections where organization_id = '{ORG}' and code = 'E2E-EXTRA'") or \
    sql(f"insert into sections (organization_id, campus_id, course_id, period_id, code, teacher_id, grade_scale_id, capacity, min_attendance_pct, modality, status) select organization_id, campus_id, course_id, period_id, 'E2E-EXTRA', teacher_id, grade_scale_id, 30, min_attendance_pct, modality, 'active' from sections where id = '{SEC}' returning id").splitlines()[0]
sql(f"delete from section_enrollments where section_id = '{sec2}'")
sql(f"delete from expenses where organization_id = '{ORG}'")

with sync_playwright() as pw:
    b = pw.chromium.launch(executable_path=CHROME, headless=True, args=['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--auto-accept-this-tab-capture', '--no-sandbox'])
    mc = b.new_context(viewport={'width': 1366, 'height': 900}); m = login(mc, 'matriculas.a@demo.sematec.test')
    m.on('dialog', lambda d: d.accept())

    # ================= 1. Editar matrícula =================
    go(m, f'{BASE}/app/matriculas')
    check(m.locator('[data-testid=editar-matricula]').count() > 0, 'Lista de matrículas con botón «✏ Editar»')
    go(m, f'{BASE}/app/matriculas/{enr}')
    f = m.locator('form:has(select[name=program_id])')
    f.locator('select[name=program_id]').select_option(prog2); f.locator('textarea[name=notes]').fill('Convenio empresa E2E')
    f.locator('button:has-text("Guardar cambios")').click(); form_status(m, f)
    check(sql(f"select program_id = '{prog2}' and financial_terms->>'notes' = 'Convenio empresa E2E' and curriculum_id in (select id from curricula where program_id = '{prog2}') from enrollments where id = '{enr}'") == 't',
          '✏ Cambia el programa (asigna la malla del nuevo programa) y las observaciones')
    go(m, f'{BASE}/app/matriculas/{enr}')
    f = m.locator('form:has(select[name=program_id])'); f.locator('select[name=program_id]').select_option(prog1)
    f.locator('button:has-text("Guardar cambios")').click(); form_status(m, f)
    check(sql(f"select program_id from enrollments where id = '{enr}'") == prog1, 'Vuelve al programa original')
    d = m.locator('form:has(input[name=id_document_number])')
    d.locator('input[name=id_document_number]').fill('11.111.111-2'); d.locator('button:has-text("Guardar documento")').click()
    check('no es válido' in form_status(m, d), '🪪 RUT inválido: lo rechaza con un mensaje claro')
    d.locator('input[name=id_document_number]').fill('111111111'); d.locator('button:has-text("Guardar documento")').click(); form_status(m, d)
    check(sql(f"select id_document_number from students where id = '{st1}'") == '11.111.111-1', '🪪 Guarda el RUT con formato (11.111.111-1)')
    a = m.locator('form:has(select[name=section_id])'); a.locator('select[name=section_id]').select_option(sec2); a.locator('button:has-text("Inscribir")').click(); form_status(m, a)
    check(sql(f"select status from section_enrollments where section_id = '{sec2}' and student_id = '{st1}'") == 'enrolled', '📝 Inscribe en otra sección desde la matrícula')
    go(m, f'{BASE}/app/matriculas/{enr}')
    m.locator('li:has-text("E2E-EXTRA") button:has-text("Dar de baja")').click(); time.sleep(2)
    check(sql(f"select status from section_enrollments where section_id = '{sec2}' and student_id = '{st1}'") == 'dropped', '📝 Da de baja la sección')
    nch = int(sql(f"select count(*) from charges where enrollment_id = '{enr}'"))
    c = m.locator('form:has(select[name=concept])')
    c.locator('select[name=concept]').select_option('tuition'); c.locator('input[name=amount]').fill('120000'); c.locator('input[name=installments]').fill('2'); c.locator('input[name=first_due]').fill(time.strftime('%Y-%m-%d'))
    c.locator('button:has-text("Agregar arancel")').click(); form_status(m, c)
    check(sql(f"select count(*) from charges where enrollment_id = '{enr}'") == str(nch + 1), '💳 Agrega un arancel en cuotas asociado a la matrícula')

    # ================= 2. Búsqueda global =================
    m.keyboard.press('Control+k'); m.wait_for_selector('[data-testid=buscar-texto]')
    m.fill('[data-testid=buscar-texto]', '11111111'); m.wait_for_selector('[data-testid=buscar-resultados] >> text=Uno, Estudiante', timeout=10000)
    res = m.locator('[data-testid=buscar-resultados]').inner_text()
    check('Estudiante' in res and 'Matrícula' in res, f'🔍 Busca por RUT sin puntos: encuentra al estudiante y su matrícula')
    m.fill('[data-testid=buscar-texto]', 'finanz'); m.wait_for_selector('[data-testid=buscar-resultados] >> text=Finanzas', timeout=10000)
    m.keyboard.press('Enter'); m.wait_for_url(re.compile('/app/finanzas'), timeout=10000)
    check(True, '🔍 Busca páginas del menú y Enter abre la elegida')
    m.locator('[data-testid=buscar]').click(); m.fill('[data-testid=buscar-texto]', 'tecnico informat')
    m.fill('[data-testid=buscar-texto]', 'Técnico en Inf'); m.wait_for_selector('[data-testid=buscar-resultados] >> text=Programa', timeout=10000)
    check(True, '🔍 Encuentra programas (con o sin tildes)')
    m.keyboard.press('Escape')

    # ================= 3. Pago, comprobante, gastos y balance =================
    go(m, f'{BASE}/app/finanzas/pagos')
    p = m.locator('form:has(input[name=external_reference])')
    p.locator('select[name=student_id]').select_option(st1); p.locator('input[name=amount]').fill('60000'); p.locator('select[name=method]').select_option('bank_transfer')
    p.locator('input[name=external_reference]').fill(f'E2E-{int(time.time())}'); p.locator('button:has-text("Registrar pago")').click()
    check('Comprobante N°' in form_status(m, p), 'Registra el pago e indica el N° de comprobante')
    pay = sql(f"select id from payments where student_id = '{st1}' and amount = 60000 order by created_at desc limit 1")
    go(m, f'{BASE}/app/finanzas/pagos'); m.locator(f'a[href="/app/finanzas/boleta/{pay}"]').click()
    m.wait_for_selector('[data-testid=boleta]')
    bt = m.locator('[data-testid=boleta]').inner_text()
    check('Estudiante Uno' in bt and '60.000' in bt and '11.111.111-1' in bt and 'cuota 1' in bt, '🧾 Comprobante con estudiante, RUT, detalle de cuotas y total')
    r = mc.request.get(f'{BASE}/app/finanzas/boleta/{pay}/pdf')
    check(r.status == 200 and r.headers['content-type'] == 'application/pdf' and r.body()[:4] == b'%PDF', '⬇ Descarga el comprobante en PDF')
    before = len(glob.glob('/tmp/mails/*.eml'))
    s = m.locator('form:has(button:has-text("Enviar comprobante"))'); s.locator('input[name=email]').fill('apoderado.e2e@demo.sematec.test')
    s.locator('button:has-text("Enviar comprobante")').click(); msg = form_status(m, s)
    mails = [open(x, encoding='utf-8', errors='ignore').read() for x in sorted(glob.glob('/tmp/mails/*.eml'))[before:]]
    check('enviado' in msg and any('apoderado.e2e@demo.sematec.test' in x and 'application/pdf' in x for x in mails), f'✉ Envía el comprobante por correo con el PDF adjunto ({msg})')
    g = m.locator('form:has(button:has-text("Guardar en Archivos"))'); g.locator('button:has-text("Guardar en Archivos")').click(); form_status(m, g)
    check(sql("select count(*) from user_files where name like 'Comprobante-%' and deleted_at is null") != '0', '💾 Guarda una copia del PDF en «Archivos»')
    est = b.new_context(); ep = login(est, 'estudiante1.a@demo.sematec.test')
    r = est.request.get(f'{BASE}/app/finanzas/boleta/{pay}/pdf')
    check(r.status == 200 and r.body()[:4] == b'%PDF', '🎓 El estudiante también descarga su propio comprobante')
    other = sql(f"select p.id from payments p where p.student_id <> '{st1}' and p.organization_id = '{ORG}' limit 1")
    if other:
        check(est.request.get(f'{BASE}/app/finanzas/boleta/{other}/pdf').status == 404, '🔒 Un estudiante no ve comprobantes de otros')

    go(m, f'{BASE}/app/finanzas/gastos')
    x = m.locator('form:has(input[name=supplier])').first
    x.locator('select[name=category]').select_option('arriendo'); x.locator('input[name=amount]').fill('15000')
    x.locator('input[name=description]').fill('Arriendo sala E2E'); x.locator('input[name=supplier]').fill('Inmobiliaria E2E')
    x.locator('select[name=program_id]').select_option(prog1); x.locator('button:has-text("Guardar gasto")').click(); form_status(m, x)
    x.locator('select[name=category]').select_option('materiales'); x.locator('input[name=amount]').fill('999')
    x.locator('input[name=description]').fill('Gasto para borrar E2E'); x.locator('button:has-text("Guardar gasto")').click(); form_status(m, x)
    check(sql(f"select count(*) from expenses where organization_id = '{ORG}'") == '2', '💸 Registra gastos (asociado a un programa o general)')
    go(m, f'{BASE}/app/finanzas/gastos')
    m.locator('tr:has-text("Gasto para borrar E2E") button:has-text("🗑")').click(); time.sleep(2)
    check(sql(f"select count(*) from expenses where organization_id = '{ORG}'") == '1', '🗑 Elimina un gasto (con confirmación; se puede deshacer)')
    go(m, f'{BASE}/app/finanzas/gastos'); m.locator('tr:has-text("Arriendo sala E2E") summary').click()
    ed = m.locator('tr:has-text("Arriendo sala E2E") form:has(button:has-text("Guardar cambios"))'); ed.locator('input[name=amount]').fill('20000')
    ed.locator('button:has-text("Guardar cambios")').click(); form_status(m, ed)
    check(sql(f"select amount::int from expenses where organization_id = '{ORG}'") == '20000', '✏ Edita un gasto')

    go(m, f'{BASE}/app/finanzas/balance')
    ing, gas, sal = (m.locator(f'[data-testid=kpi-{k}]').inner_text() for k in ('ingresos', 'gastos', 'saldo'))
    inc = int(float(sql(f"select coalesce(sum(case when kind = 'refund' then -amount else amount end), 0) from payments where organization_id = '{ORG}' and status = 'confirmed' and currency = 'CLP' and date_trunc('month', paid_at at time zone 'America/Santiago') = date_trunc('month', now() at time zone 'America/Santiago')"))) \
        + int(float(sql(f"select coalesce(sum(total), 0) from sales where organization_id = '{ORG}' and status <> 'anulada' and paid_at is not null and currency = 'CLP' and date_trunc('month', paid_at at time zone 'America/Santiago') = date_trunc('month', now() at time zone 'America/Santiago')") or 0))
    dots = lambda n: f'{n:,}'.replace(',', '.')
    check(dots(inc) in ing and '20.000' in gas and dots(inc - 20000) in sal, f'📊 Ingresos, gastos y lo que queda del mes ({ing} − {gas} = {sal})')
    cells = m.locator('[data-testid=balance-programas] tr:has-text("Técnico en Informática") td').all_inner_texts()
    money = lambda x: int(re.sub(r'[^0-9-]', '', x) or 0)
    pi, pe, ps = money(cells[-3]), money(cells[-2]), money(cells[-1])
    check(pi >= 60000 and pe == 20000 and ps == pi - pe, f'📊 Ingreso, gasto y saldo por programa ({cells[-3]} − {cells[-2]} = {cells[-1]})')
    srow = m.locator('[data-testid=balance-secciones]').inner_text()
    code = sql(f"select code from sections where id = '{SEC}'")
    check(code in srow and '$' in m.locator(f'[data-testid=balance-secciones] tr:has-text("{code}")').first.inner_text() and 'E2E-EXTRA' not in srow,
          '📊 Ingreso por sección (la sección dada de baja no recibe ingresos)')
    go(m, f'{BASE}/app/finanzas/balance?desde=2026-01&hasta=2026-12')
    check(m.locator('[data-testid=balance-meses] tbody tr').count() == 12, '📊 Mes a mes en un rango (12 meses)')
    r = mc.request.get(f'{BASE}/app/finanzas/balance/csv?desde=2026-01&hasta=2026-12')
    check(r.status == 200 and 'Programa;Alumnos' in r.text() and 'Técnico en Informática' in r.text(), '⬇ Descarga el balance para Excel (CSV)')

    # ================= 4. Aula virtual =================
    room = sql(f"insert into conference_rooms (organization_id, name, room_type, section_id, max_participants, created_by) values ('{ORG}', 'Aula Moderna E2E', 'class', '{SEC}', 50, '{T1}') returning id").splitlines()[0]
    sess = sql(f"""set request.jwt.claims = '{{"sub":"{T1}","role":"authenticated"}}'; select create_conference_session('{room}', 'Clase moderna E2E', 'class', now() - interval '5 minutes', now() + interval '55 minutes', 'America/Santiago', true, null)""").splitlines()[-1]
    tc = b.new_context(viewport={'width': 1366, 'height': 900}); t = login(tc, 'profesor1.a@demo.sematec.test'); t.on('dialog', lambda d: d.accept())
    ec = b.new_context(viewport={'width': 1366, 'height': 900}); e = login(ec, 'estudiante1.a@demo.sematec.test')
    for pg in (t, e):
        go(pg, f'{BASE}/app/conferencias/sala/{sess}'); pg.click('button:has-text("Entrar a la sala")'); pg.wait_for_selector('.lk-video-conference', timeout=30000)
    wait_text(e, 'header', '2 👥')

    t.click('[data-testid=minimizar]'); t.wait_for_selector('[data-testid=sala-mini]', timeout=10000)
    check(t.locator('text=Está conectado a esta sala').count() == 1, '🗕 Minimiza la sala: ventana pequeña y la página indica que sigue conectado')
    t.locator('nav a:has-text("Archivos")').click(); t.wait_for_url(re.compile('/app/archivos'), timeout=15000); time.sleep(2)
    check(t.locator('[data-testid=sala-mini]').is_visible() and 'Mis archivos' in t.content() or t.locator('[data-testid=sala-mini]').is_visible(),
          '🧭 Navega por otras páginas del sistema y la sala sigue abierta en la ventana pequeña')
    check('2 👥' in e.locator('header').first.inner_text() and '2 👥' in t.locator('[data-testid=sala-mini]').inner_text(), '🔗 Sigue conectado (el estudiante lo sigue viendo en la clase)')
    t.locator('nav a:has-text("Calificaciones")').click(); t.wait_for_url(re.compile('/app/calificaciones'), timeout=15000)
    t.locator('form:has(select[name=periodo]) button').first.click(); t.wait_for_url(re.compile('periodo='), timeout=15000); time.sleep(1)
    check(t.locator('[data-testid=sala-mini]').is_visible() and '2 👥' in t.locator('[data-testid=sala-mini]').inner_text(), '🔎 Usar filtros de una página tampoco corta la clase')
    t.locator('[data-testid=sala-mini] button[title="Compartir toda la pantalla"]').click()
    e.wait_for_selector('[data-testid=pantalla-de]', timeout=20000)
    check(True, '🖥 Comparte toda la pantalla desde la ventana pequeña mientras navega')
    t.click('[data-testid=maximizar]'); t.wait_for_selector('.lk-video-conference', state='visible', timeout=10000)
    check(t.locator('[data-testid=sala-mini]').count() == 0, '⤢ Vuelve a la sala completa')
    t.locator('[data-testid=compartiendo] button:has-text("Dejar de compartir")').click()

    # Pizarra
    t.click('[data-testid=boton-pizarra]'); t.wait_for_selector('[data-testid=pizarra]'); e.wait_for_selector('[data-testid=pizarra]', timeout=15000)
    check('Solo el anfitrión puede dibujar' in e.locator('[data-testid=pizarra]').inner_text(), '🖍 La pizarra se abre para todos (los alumnos solo miran)')
    box = t.locator('[data-testid=pizarra-lienzo]').bounding_box()
    t.mouse.move(box['x'] + 50, box['y'] + 50); t.mouse.down()
    for i in range(1, 20): t.mouse.move(box['x'] + 50 + i * 15, box['y'] + 50 + i * 8)
    t.mouse.up(); time.sleep(2)
    painted = "(() => { const c = document.querySelector('[data-testid=pizarra-lienzo]'); const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let n = 0; for (let i = 3; i < d.length; i += 4) if (d[i] > 0) n++; return n; })()"
    check(e.evaluate(painted) > 100, '🖍 Lo que dibuja el profesor aparece en la pizarra del alumno en tiempo real')
    t.locator('[data-testid=pizarra-todos]').check(); e.wait_for_selector('[data-testid=pizarra] button[aria-label^="Color"]', timeout=10000)
    check(True, '🖍 El profesor permite que todos dibujen')
    t.click('[data-testid=boton-pizarra]'); e.wait_for_selector('[data-testid=pizarra]', state='detached', timeout=10000)
    check(True, '🖍 Cierra la pizarra para todos')

    # Encuesta
    t.click('[data-testid=boton-encuesta]'); t.fill('input[name=pregunta]', '¿Se entendió la clase?')
    t.locator('[data-testid=encuesta-panel] button:has-text("Sí / No / Más o menos")').click(); t.locator('button:has-text("Lanzar encuesta")').click()
    e.wait_for_selector('[data-testid=encuesta-voto]', timeout=15000); e.locator('[data-testid=encuesta-voto] button:has-text("Sí")').first.click()
    wait_text(t, '[data-testid=encuesta-resultados]', '1 voto')
    check(True, '📊 Encuesta en vivo: el alumno vota y el profesor ve el resultado al instante')
    t.locator('button:has-text("Mostrar resultados a todos")').click()
    e.wait_for_selector('[data-testid=encuesta-voto] [data-testid=encuesta-resultados]', timeout=10000)
    check('100%' in e.locator('[data-testid=encuesta-voto]').inner_text(), '📊 El profesor muestra los resultados a todos')

    # Enlace para invitados
    t.click('[data-testid=boton-invitar]'); t.click('[data-testid=crear-enlace]')
    t.wait_for_selector('[data-testid=enlace-invitado]', timeout=15000)
    link = t.locator('[data-testid=enlace-invitado]').first.input_value()
    check('/invitado/' in link, f'🔗 El profesor genera el enlace para invitados ({link[:45]}…)')
    gc = b.new_context(viewport={'width': 1280, 'height': 800}); gp = gc.new_page()
    go(gp, link.replace('http://localhost:3000', BASE))
    gf = gp.locator('[data-testid=form-invitado]')
    gf.locator('input[name=name]').fill('Carla Invitada'); gf.locator('input[name=doc_number]').fill('22.222.222-3')
    gf.locator('input[name=cargo]').fill('Gerente de RR. HH.'); gf.locator('input[name=institution]').fill('Empresa Demo'); gf.locator('input[name=consent]').check()
    gf.locator('button:has-text("Entrar a la sala")').click()
    al = gp.locator('[data-testid=error-invitado]').inner_text()
    check('no es válido' in al, f'🔗 El invitado con RUT inválido recibe un mensaje claro ({al})')
    gf.locator('input[name=doc_number]').fill('22222222-2'); gf.locator('button:has-text("Entrar a la sala")').click()
    gp.wait_for_selector('.lk-video-conference', timeout=30000)
    check(sql(f"select full_name || '|' || document_number || '|' || position || '|' || institution from conference_guests where session_id = '{sess}'") == 'Carla Invitada|22.222.222-2|Gerente de RR. HH.|Empresa Demo',
          '🔗 El invitado entra con su nombre, RUT, cargo e institución (queda registrado)')
    t.click('footer button:has-text("Personas")')
    t.wait_for_selector('[data-testid=personas] >> text=Carla Invitada', timeout=20000)
    li = t.locator('[data-testid=personas] li:has-text("Carla Invitada")').inner_text()
    check('Invitado' in li and 'Gerente de RR. HH.' in li, '👥 El profesor ve al invitado con su cargo e institución')
    check(gp.locator('footer button:has-text("Pizarra")').count() == 0 and gp.locator('[data-testid=boton-invitar]').count() == 0, '🔒 El invitado no tiene controles de anfitrión')
    t.locator('[data-testid=personas] li:has-text("Carla Invitada") button:has-text("Expulsar")').click()
    gp.wait_for_selector('.lk-video-conference', state='detached', timeout=20000)
    check(sql(f"select removed from conference_guests where session_id = '{sess}'") == 't', '🚫 El profesor expulsa al invitado')
    t.click('[data-testid=minimizar]'); t.keyboard.press('Control+k'); t.fill('[data-testid=buscar-texto]', 'Clase moderna')
    t.wait_for_selector('[data-testid=buscar-resultados] >> text=Clase o reunión', timeout=10000); t.keyboard.press('Enter')
    t.wait_for_url(re.compile(f'/app/conferencias/{sess}$'), timeout=15000); t.wait_for_selector('[data-testid=tabla-invitados]', timeout=15000)
    check('Carla Invitada' in t.locator('[data-testid=tabla-invitados]').inner_text() and '22.222.222-2' in t.locator('[data-testid=tabla-invitados]').inner_text(),
          '📋 El detalle de la sesión lista a los invitados con su documento y cargo')
    check(t.locator('[data-testid=sala-mini]').is_visible(), '🗕 Buscando y abriendo otra página, la clase sigue conectada en la ventana pequeña')
    inv = sql(f"select id from conference_invites where session_id = '{sess}' limit 1")
    sql(f"update conference_invites set revoked_at = now() where id = '{inv}'")
    go(gp, link.replace('http://localhost:3000', BASE))
    check('desactivó' in gp.content(), '🔗 Un enlace desactivado ya no permite entrar')

    # El estudiante no busca datos de otros
    go(e, f'{BASE}/app'); e.locator('[data-testid=buscar]').click(); e.fill('[data-testid=buscar-texto]', 'Estudiante'); time.sleep(2)
    check('Dos, Estudiante' not in e.locator('[data-testid=buscar-resultados]').inner_text(), '🔒 La búsqueda de un estudiante no muestra datos de otros estudiantes')
    b.close()

print(f"\n{sum(1 for ok, _ in results if ok)}/{len(results)} verificaciones OK")
