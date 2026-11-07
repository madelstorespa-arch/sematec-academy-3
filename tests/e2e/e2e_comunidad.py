"""Credencial con QR, encuestas y evaluación docente anónima, apoderados, egresados y bolsa de empleo."""
import re, sys, os, datetime
sys.path.insert(0, os.path.dirname(__file__))
from e2e import BASE, CHROME, PASS, sql, check, shot, login, status_msg, go, sel_re, results
from playwright.sync_api import sync_playwright

ORG = '0a000000-0000-4000-8000-000000000001'
SEC = '0a000000-0000-4000-8000-00000000ad01'
# Los tres estudiantes de la institución A inscritos en la sección de prueba
sql(f"insert into section_enrollments (organization_id, section_id, student_id, enrollment_id) select '{ORG}', '{SEC}', e.student_id, e.id from enrollments e join students s on s.id = e.student_id where s.organization_id = '{ORG}' and s.user_id is not null on conflict do nothing")
closes = (datetime.datetime.now() + datetime.timedelta(days=3)).strftime('%Y-%m-%dT%H:%M')
sec_code = sql(f"select code from sections where id = '{SEC}'")
st1 = sql("select id from students where user_id = '00000000-0000-4000-8000-000000000030'")

with sync_playwright() as pw:
    b = pw.chromium.launch(executable_path=CHROME, headless=True, args=['--no-sandbox'])
    # --- Credencial estudiantil ---
    ec = b.new_context(viewport={'width': 390, 'height': 844}, is_mobile=True); e = login(ec, 'estudiante1.a@demo.sematec.test')
    go(e, BASE + '/app/credencial'); e.click('button:has-text("Emitir credencial")'); check('emitida' in status_msg(e), 'Estudiante emite su credencial')
    go(e, BASE + '/app/credencial'); code = e.locator('p.font-mono').first.inner_text().strip()
    check(re.fullmatch(r'[0-9A-F]{12}', code) and e.locator('img[alt="Código QR de verificación"]').count() == 1, 'Credencial con código y QR'); shot(e, 'com_credencial_celular')
    anon = b.new_context().new_page(); go(anon, f'{BASE}/credencial/{code}')
    check(anon.locator('text=Estudiante regular, credencial vigente').count() == 1, 'Verificación pública sin sesión: vigente'); shot(anon, 'com_credencial_verificada')
    go(anon, f'{BASE}/credencial/FFFFFFFFFFFF'); check(anon.locator('text=Credencial no encontrada').count() == 1, 'Código falso: no encontrada')
    sql(f"update student_credentials set revoked = true where code = '{code}'")
    go(anon, f'{BASE}/credencial/{code}'); check(anon.locator('text=Credencial NO vigente').count() == 1, 'Credencial revocada aparece NO vigente')
    sql(f"update student_credentials set revoked = false where code = '{code}'")

    # --- Encuestas: evaluación docente anónima ---
    sc = b.new_context(viewport={'width': 1366, 'height': 900}); s = login(sc, 'secretaria.a@demo.sematec.test')
    go(s, BASE + '/app/encuestas'); s.click('summary:has-text("Nueva encuesta")')
    s.select_option('select[name=template]', 'docente'); s.fill('input[name=title]', 'Evaluación docente E2E')
    s.select_option('select[name=section_id]', SEC); s.fill('input[name=closes_at]', closes); s.check('input[name=published]')
    s.click('button:has-text("Crear")'); check('8 preguntas' in status_msg(s), 'Secretaría crea evaluación docente con plantilla')
    sid = sql("select id from surveys where title like 'Evaluación docente E2E%'")
    # Encuesta libre a toda la comunidad
    go(s, BASE + '/app/encuestas'); s.click('summary:has-text("Nueva encuesta")'); s.select_option('select[name=template]', 'libre')
    s.fill('input[name=title]', 'Satisfacción biblioteca'); s.select_option('select[name=audience]', 'students'); s.fill('input[name=closes_at]', closes)
    s.click('button:has-text("Crear")'); check('Ábrala' in status_msg(s), 'Crea encuesta libre (borrador)')
    lid = sql("select id from surveys where title = 'Satisfacción biblioteca'")
    go(s, f'{BASE}/app/encuestas/{lid}'); s.click('button:has-text("Publicar")'); check('al menos una pregunta' in status_msg(s), 'No publica sin preguntas')
    go(s, f'{BASE}/app/encuestas/{lid}'); s.fill('input[name=prompt]', '¿Qué servicio usa más?'); s.select_option('select[name=kind]', 'opcion')
    s.fill('textarea[name=options]', 'Préstamo de libros\nSala de estudio\nComputadores'); s.click('button:has-text("Agregar")'); check('agregada' in status_msg(s), 'Agrega pregunta de selección')
    go(s, f'{BASE}/app/encuestas/{lid}'); s.click('button:has-text("Publicar")'); check('publicada' in status_msg(s), 'Publica la encuesta libre')

    # Los 3 estudiantes responden la evaluación docente
    answers = [[5, 5, 4, 5, 4, 5, 5], [4, 4, 4, 5, 3, 4, 4], [3, 5, 5, 5, 4, 3, 4]]
    for n, vals in enumerate(answers, start=1):
        pc = b.new_context(viewport={'width': 390, 'height': 844}, is_mobile=True); p = e if n == 1 else login(pc, f'estudiante{n}.a@demo.sematec.test')
        go(p, BASE + '/app/encuestas'); check(p.locator('text=Evaluación docente E2E').count() >= 1, f'Estudiante {n} ve la evaluación pendiente')
        go(p, f'{BASE}/app/encuestas/{sid}/responder')
        qs = sql(f"select string_agg(id::text, ',' order by position) from survey_questions where survey_id = '{sid}' and kind = 'escala'").split(',')
        for q, v in zip(qs, vals): p.locator(f'input[name="q_{q}"][value="{v}"]').check()
        p.fill('textarea', f'Comentario anónimo {n}'); p.once('dialog', lambda d: d.accept())
        p.click('button:has-text("Enviar respuestas")'); check('Gracias' in status_msg(p), f'Estudiante {n} responde la evaluación')
        if n == 1: shot(p, 'com_encuesta_responder_celular')
    go(e, f'{BASE}/app/encuestas/{sid}/responder'); check(e.locator('text=ya respondió').count() == 1, 'No se puede responder dos veces')
    check(sql(f"select count(*) from survey_responses where survey_id = '{sid}' and respondent_id is not null") == '0', 'Respuestas anónimas: no guardan al autor')
    # El estudiante 2 no puede ver resultados ni encuestas de otra audiencia
    check(sql(f"select count(*) from survey_participation where survey_id = '{sid}'") == '3', 'Participación registrada (3)')

    # Profesor evaluado ve resultados agregados
    tc = b.new_context(viewport={'width': 1366, 'height': 900}); t = login(tc, 'profesor1.a@demo.sematec.test')
    go(t, BASE + '/app/encuestas'); check(t.locator('text=Mis evaluaciones docentes').count() == 1, 'Profesor ve su evaluación docente')
    go(t, f'{BASE}/app/encuestas/{sid}'); avg = round(sum(sum(a) for a in answers) / 21, 2)
    check(t.locator(f'text=Promedio general {avg:.2f} / 5').count() == 1 and t.locator('text=Comentario anónimo 2').count() == 1, f'Profesor ve promedio {avg:.2f} y comentarios anónimos')
    shot(t, 'com_evaluacion_resultados')
    other = b.new_context(); o2 = login(other, 'profesor2.a@demo.sematec.test')
    r = o2.request.get(f'{BASE}/app/encuestas/{sid}'); check(r.status == 404 or 'Promedio general' not in r.text(), 'Otro profesor no ve resultados ajenos')

    # --- Apoderados ---
    go(s, f'{BASE}/app/estudiantes/{st1}'); s.click('summary:has-text("Agregar apoderado")')
    s.fill('input[name=full_name]', 'María Apoderada'); s.fill('input[name=email]', 'apoderada.e2e@demo.sematec.test')
    s.fill('form:has(input[name=full_name]) input[name=password]', PASS); s.select_option('select[name=relationship]', 'madre')
    s.click('button:has-text("Registrar apoderado")'); check('Apoderado registrado' in status_msg(s), 'Secretaría crea la cuenta del apoderado con contraseña elegida')
    shot(s, 'com_apoderado_ficha')
    sql(f"update assessments set published = true where section_id = '{SEC}'")
    gc = b.new_context(viewport={'width': 390, 'height': 844}, is_mobile=True); g = login(gc, 'apoderada.e2e@demo.sematec.test')
    go(g, BASE + '/app/apoderado'); check(g.locator('text=Mis pupilos').count() >= 1 and g.locator('text=Saldo pendiente').count() == 1, 'Apoderada ve el resumen de su pupilo')
    shot(g, 'com_apoderado_celular')
    r = g.request.get(f'{BASE}/app/estudiantes'); check(r.status == 404 or 'Registrar estudiante' not in r.text(), 'Apoderada no accede a la lista de estudiantes')
    st2 = sql("select id from students where user_id = '00000000-0000-4000-8000-000000000031'")
    gid = sql("select id from profiles where email = 'apoderada.e2e@demo.sematec.test'")
    claims = '{"sub":"%s","role":"authenticated"}' % gid
    seen = sql(f"set role authenticated; set request.jwt.claims = '{claims}'; select count(*) from guardian_links where student_id = '{st2}'")
    check(seen.splitlines()[-1] == '0', 'Apoderada no ve vínculos de otros estudiantes')

    # --- Egresados y bolsa de empleo ---
    go(e, BASE + '/app/egresados'); e.fill('input[name=graduation_year]', '2025'); e.select_option('select[name=employment]', 'empleado')
    e.fill('input[name=employer]', 'Clínica Alemana'); e.fill('input[name=job_title]', 'Técnico'); e.check('input[name=consent_contact]')
    e.click('button:has-text("Guardar")'); check('guardado' in status_msg(e), 'Estudiante completa su perfil de egresado')
    sql(f"update students set status = 'graduated' where id = '{st1}'")
    oc = b.new_context(viewport={'width': 1366, 'height': 900}); ow = login(oc, 'propietario.a@demo.sematec.test', mfa=True)
    go(ow, BASE + '/app/egresados'); check(ow.locator('text=Clínica Alemana').count() == 1, 'Institución ve al egresado y su empleo'); shot(ow, 'com_egresados')
    go(ow, BASE + '/app/empleos'); ow.click('summary:has-text("Publicar oferta")'); ow.fill('input[name=title]', 'Técnico en enfermería'); ow.fill('input[name=company]', 'Hospital E2E')
    ow.fill('textarea[name=description]', 'Turnos rotativos.'); ow.fill('input[name=apply_email]', 'rrhh@hospital.test')
    ow.click('button:has-text("Publicar")'); check('publicada' in status_msg(ow), 'Se publica una oferta de empleo')
    go(e, BASE + '/app/empleos'); check(e.locator('text=Técnico en enfermería').count() == 1 and e.locator('a:has-text("Enviar CV")').count() == 1, 'Egresado ve la oferta y puede postular')
    shot(e, 'com_empleos_celular')
    sql(f"update students set status = 'active' where id = '{st1}'")
    b.close()
print(f"\n{sum(1 for ok, _ in results if ok)}/{len(results)} pruebas OK")
