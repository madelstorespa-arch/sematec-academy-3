"""Etapa 4: contraseñas con 👁 y filtros, sin N° de documento, carreras, precios con descuento, biblioteca virtual,
pago de cuotas con banco/tarjeta, Punto estudiantil, oficinas (mesa y citas) y administración del propietario."""
import re, sys, os, datetime
sys.path.insert(0, os.path.dirname(__file__))
from e2e import BASE, CHROME, sql, check, shot, login, status_msg, go, results
from playwright.sync_api import sync_playwright

ORG = '0a000000-0000-4000-8000-000000000001'
SEC = '0a000000-0000-4000-8000-00000000ad01'
st1 = sql("select id from students where user_id = '00000000-0000-4000-8000-000000000030'")
sql(f"insert into section_enrollments (organization_id, section_id, student_id, enrollment_id) select '{ORG}', '{SEC}', e.student_id, e.id from enrollments e where e.student_id = '{st1}' on conflict do nothing")
# Cuotas pendientes del estudiante 1
acc = sql(f"insert into student_accounts (organization_id, student_id, currency) values ('{ORG}', '{st1}', 'CLP') on conflict do nothing returning id") or sql(f"select id from student_accounts where student_id = '{st1}' and currency = 'CLP'")
acc = acc.splitlines()[0]
ch = sql(f"insert into charges (organization_id, account_id, student_id, concept, gross_amount, currency) values ('{ORG}', '{acc}', '{st1}', 'Arancel E2E', 90000, 'CLP') returning id").splitlines()[0]
sql(f"insert into installments (organization_id, charge_id, number, amount, due_on) values ('{ORG}', '{ch}', 1, 30000, current_date - 5), ('{ORG}', '{ch}', 2, 30000, current_date + 25), ('{ORG}', '{ch}', 3, 30000, current_date + 55)")

with sync_playwright() as pw:
    b = pw.chromium.launch(executable_path=CHROME, headless=True, args=['--no-sandbox'])
    oc = b.new_context(viewport={'width': 1366, 'height': 900}); o = login(oc, 'propietario.a@demo.sematec.test', mfa=True)

    # --- Cuentas: contraseña con 👁 y filtros ---
    go(o, BASE + '/app/usuarios')
    pw_in = o.locator('form:has(input[name=full_name]) input[name=password]')
    check(pw_in.get_attribute('type') == 'password', 'Contraseña oculta por defecto')
    o.locator('form:has(input[name=full_name]) button[aria-label="Mostrar contraseña"]').click()
    check(pw_in.get_attribute('type') == 'text', 'Botón 👁 muestra la contraseña')
    go(o, BASE + '/app/usuarios?rol=estudiante')
    check(o.locator('text=estudiante1.a@demo.sematec.test').count() >= 1 and o.locator('text=secretaria.a@demo.sematec.test').count() == 0, 'Filtro de usuarios por rol')
    go(o, BASE + '/app/estudiantes?acceso=sin')
    sin = o.locator('text=Uno, Estudiante').count()
    go(o, BASE + '/app/estudiantes?acceso=con')
    check(sin == 0 and o.locator('text=Uno, Estudiante').count() == 1, 'Filtro de estudiantes con / sin cuenta')

    # --- Estudiante nuevo con su documento de identidad ---
    go(o, BASE + '/app/estudiantes?nuevo=1')
    check(o.locator('input[name=id_document_number]').count() == 1, 'El formulario pide el documento de identidad')
    o.fill('input[name=student_code]', 'EST-E2E4'); o.fill('input[name=first_names]', 'Nora'); o.fill('input[name=last_names]', 'Sin Documento')
    o.select_option('form:has(input[name=student_code]) select[name=id_document_type]', 'PASAPORTE'); o.fill('form:has(input[name=student_code]) input[name=id_document_number]', 'P1234567')
    o.fill('input[name=email]', 'nora.e2e@demo.sematec.test'); o.fill('form:has(input[name=student_code]) input[name=password]', 'NoraSinDoc2026')
    o.click('button:has-text("Registrar estudiante")'); m = status_msg(o)
    check(m.startswith('✓'), f'Estudiante registrado con pasaporte y su cuenta ({m[:50]})')
    check(sql("select count(*) from students where student_code = 'EST-E2E4' and user_id is not null") == '1', 'Cuenta creada y vinculada al registrarlo')

    go(o, BASE + '/app/profesores'); o.click('summary:has-text("Registrar profesor")') if o.locator('summary:has-text("Registrar profesor")').count() else None
    o.fill('input[name=teacher_code]', 'DOC-E2E4'); o.fill('form:has(input[name=teacher_code]) input[name=first_names]', 'Marc')
    o.fill('form:has(input[name=teacher_code]) input[name=last_names]', 'Vertisma'); o.fill('form:has(input[name=teacher_code]) input[name=email]', 'marc.doc@demo.sematec.test')
    o.fill('form:has(input[name=teacher_code]) input[name=password]', 'MarcAndre1998')
    check(o.locator('form:has(input[name=teacher_code]) input[name=id_document_number]').count() == 1, 'Formulario de profesor con documento (opcional)')
    o.click('button:has-text("Registrar profesor")'); m = status_msg(o)
    check('con su cuenta' in m and sql("select count(*) from teachers where teacher_code = 'DOC-E2E4' and user_id is not null") == '1', f'Profesor registrado con su cuenta ({m[:50]})')

    # --- Carrera nueva, editar, suspender ---
    go(o, BASE + '/app/academico')
    o.fill('input[name=code]', 'ENF-E2E'); o.fill('input[name=name]', 'Técnico en Enfermería E2E')
    o.select_option('select[name=level]', 'technical'); o.fill('input[name=duration_terms]', '4'); o.fill('input[name=valid_from]', '2026-03-01'); o.locator('select[name=grade_scale_id]').select_option(index=1)
    o.click('button:has-text("Crear carrera")'); m = status_msg(o); check(m.startswith('✓'), f'Crea carrera nueva ({m[:50]})')
    prog = sql("select id from programs where code = 'ENF-E2E'")
    go(o, BASE + '/app/academico'); row = o.locator('tr:has-text("ENF-E2E")')
    row.locator('summary:has-text("Editar")').click(); row.locator('input[name=name]').fill('Técnico en Enfermería (vespertino)')
    row.locator('button:has-text("Guardar")').click(); status_msg(o)
    check(sql(f"select name from programs where id = '{prog}'") == 'Técnico en Enfermería (vespertino)', 'Edita la carrera')
    go(o, BASE + '/app/academico'); o.once('dialog', lambda d: d.accept())
    o.locator('tr:has-text("ENF-E2E") button:has-text("Suspender")').click(); status_msg(o)
    check(sql(f"select status from programs where id = '{prog}'") == 'inactive', 'Propietario suspende la carrera')
    go(o, BASE + '/app/academico'); o.locator('tr:has-text("ENF-E2E") button:has-text("Activar")').click(); status_msg(o)
    check(sql(f"select status from programs where id = '{prog}'") == 'active', 'Propietario reactiva la carrera')
    shot(o, 'e4_carreras')

    # --- Eliminar con historial: mensaje claro; suspender estudiante ---
    go(o, f'{BASE}/app/estudiantes?q=Uno'); o.once('dialog', lambda d: d.accept())
    o.locator('tr:has-text("Uno, Estudiante") button:has-text("Eliminar")').click(); m = status_msg(o)
    check('registros asociados' in m, f'Eliminar con historial: explica y sugiere suspender ({m[:60]})')

    # --- Catálogo: carrera con descuento ---
    go(o, BASE + '/app/sitio/cursos'); o.click('summary:has-text("Nuevo curso o carrera")')
    o.fill('input[name=title]', 'Carrera de Enfermería E2E'); o.fill('input[name=slug]', 'enfermeria-e2e'); o.select_option('select[name=kind]', 'carrera')
    o.fill('input[name=regular_price]', '100000'); o.fill('input[name=discount_pct]', '20')
    o.fill('input[name=discount_ends_on]', (datetime.date.today() + datetime.timedelta(days=10)).isoformat())
    o.locator('select[name=program_id]').select_option(index=1); o.locator('select[name=period_id]').select_option(index=1)
    o.fill('textarea[name=summary]', 'Carrera técnica con práctica clínica.'); o.check('input[name=is_published]')
    o.click('button:has-text("Crear curso")'); m = status_msg(o); check(m.startswith('✓'), f'Crea carrera en el catálogo con descuento ({m[:40]})')
    check(sql("select price::int || '|' || regular_price::int from catalog_offerings where slug = 'enfermeria-e2e'") == '80000|100000', 'Precio con 20 % de descuento = 80.000')
    sql(f"update site_settings set is_published = true where organization_id = '{ORG}'")
    pc = b.new_context(viewport={'width': 390, 'height': 844}, is_mobile=True); pub = pc.new_page()
    go(pub, BASE + '/cursos?tipo=carrera')
    check(pub.locator('text=Carrera de Enfermería E2E').count() == 1 and pub.locator('text=Ahorras $20.000').count() >= 1, 'Sitio: «Carreras disponibles» con precio normal, descuento y ahorro')
    shot(pub, 'e4_carreras_disponibles_celular')
    sql("update catalog_offerings set discount_ends_on = current_date - 1 where slug = 'enfermeria-e2e'")
    oid = sql("select id from catalog_offerings where slug = 'enfermeria-e2e'")
    check(sql(f"select current_price::int from offering_prices('{ORG}') where id = '{oid}'") == '100000', 'Vencido el descuento se cobra el precio normal')

    # --- Biblioteca virtual asociada a la asignatura ---
    pdf = '/tmp/libro_e2e.pdf'
    open(pdf, 'wb').write(b'%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n')
    go(o, BASE + '/app/biblioteca'); o.click('summary:has-text("Agregar libro")')
    o.fill('input[name=title]', 'Manual de SQL E2E'); o.select_option('select[name=item_type]', 'ebook')
    o.select_option('select[name=section_id]', SEC); o.set_input_files('input[name=file]', pdf)
    o.click('button:has-text("Agregar")'); m = status_msg(o); check('Libro virtual agregado' in m, f'Sube libro virtual asociado al curso ({m[:40]})')

    ec = b.new_context(viewport={'width': 390, 'height': 844}, is_mobile=True); e = login(ec, 'estudiante1.a@demo.sematec.test')
    go(e, BASE + '/app/biblioteca')
    check(e.locator('text=Manual de SQL E2E').count() >= 1, 'Estudiante ve el libro en «Mis libros virtuales»'); shot(e, 'e4_libros_celular')
    fid = sql("select file_id from library_items where title = 'Manual de SQL E2E'")
    r = e.request.get(f'{BASE}/app/biblioteca/libro/{fid}')
    check(r.status == 200 and r.headers['content-type'] == 'application/pdf', 'El libro se abre (PDF)')
    go(e, f'{BASE}/app/aula/{SEC}'); check(e.locator('text=Libros virtuales de esta asignatura').count() == 1, 'El libro aparece en el aula del curso')

    # --- Pago de cuotas con el banco ---
    go(e, BASE + '/app/mi')
    check(e.locator('text=Pagar en línea').count() == 1 and e.locator('input[name=inst]').count() == 3, 'Portal: cuotas para pagar en línea')
    e.check('input[name=provider][value=fintoc]'); e.locator('label:has(input[value=cl_banco_estado])').click()
    shot(e, 'e4_pagar_cuotas_celular')
    e.click('button:has-text("Pagar $")'); e.wait_for_selector('#provider', timeout=20000); e.click('#approve')
    e.wait_for_url(re.compile(r'/pago/resultado/'), timeout=30000); e.wait_for_selector('text=Tus cuotas quedaron pagadas', timeout=20000)
    paid = sql(f"select string_agg(number::text || ':' || outstanding::int, ',' order by number) from installment_balances where charge_id = '{ch}'")
    check(paid == '1:0,2:30000,3:30000', f'Cuota vencida pagada y registrada en la cuenta ({paid})')

    # --- Punto estudiantil ---
    go(e, BASE + '/app/punto-estudiantil')
    e.select_option('select[name=kind]', 'cert_alumno_regular'); e.fill('input[name=subject]', 'Certificado para beca')
    e.click('button:has-text("Enviar solicitud")'); m = status_msg(e); check('Solicitud N°' in m, f'Estudiante ingresa trámite ({m[:40]})')
    sc = b.new_context(viewport={'width': 1366, 'height': 900}); s = login(sc, 'secretaria.a@demo.sematec.test')
    go(s, BASE + '/app/punto-estudiantil'); s.click('summary:has-text("Responder")')
    s.select_option('select[name=status]', 'resuelta'); s.fill('textarea[name=response]', 'Certificado disponible en Certificados.')
    s.click('button:has-text("Guardar y notificar")'); status_msg(s)
    go(e, BASE + '/app/punto-estudiantil')
    check(e.locator('text=Certificado disponible en Certificados.').count() == 1 and e.locator('text=Resuelta').count() >= 1, 'Estudiante ve la respuesta')
    shot(e, 'e4_punto_estudiantil_celular')

    # --- Oficinas: cita y mesa de discusión ---
    when = (datetime.datetime.now() + datetime.timedelta(days=2)).strftime('%Y-%m-%dT10:30')
    go(e, BASE + '/app/oficinas/secretaria')
    e.fill('input[name=starts_at]', when); e.fill('input[name=topic]', 'Revisar mi matrícula')
    e.click('button:has-text("Solicitar cita")'); m = status_msg(e); check('Cita solicitada' in m, 'Estudiante pide cita con Secretaría')
    go(s, BASE + '/app/oficinas/secretaria?t=citas'); s.fill('input[name=note]', 'Oficina 2, segundo piso')
    s.click('button:has-text("Aplicar")'); status_msg(s)
    go(e, BASE + '/app/oficinas'); check(e.locator('text=Confirmada').count() >= 1, 'Secretaría confirma y el estudiante la ve confirmada')
    go(s, BASE + '/app/oficinas/secretaria?t=mesa')
    s.fill('input[name=title]', 'Calendario de matrículas'); s.fill('textarea[name=body]', 'Propongo abrir el 1 de diciembre.')
    s.click('button:has-text("Publicar")'); status_msg(s)
    shot(s, 'e4_oficina_mesa')
    tc = b.new_context(); t = login(tc, 'profesor1.a@demo.sematec.test')
    go(t, BASE + '/app/oficinas/secretaria?t=mesa')
    check(t.locator('text=Calendario de matrículas').count() == 0, 'La mesa de Secretaría no es visible para un profesor')
    go(t, BASE + '/app/oficinas'); check(t.locator('text=Sala de profesores').count() >= 1, 'El profesor tiene su oficina «Sala de profesores»')
    b.close()
print(f"\n{sum(1 for ok, _ in results if ok)}/{len(results)} pruebas OK")
