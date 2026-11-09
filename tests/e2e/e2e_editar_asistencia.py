"""Editor universal del propietario, asistencia completa (QR, aula virtual, profesores, personal, reportes) y Actualizar sistema."""
import re, sys, os, time
sys.path.insert(0, os.path.dirname(__file__))
from e2e import BASE, CHROME, sql, check, login, status_msg, go, results
from playwright.sync_api import sync_playwright

ORG = '0a000000-0000-4000-8000-000000000001'
SEC = '0a000000-0000-4000-8000-00000000ad01'     # sección con 4 estudiantes (profesor1)
SEC_EMPTY = '0a000000-0000-4000-8000-00000000ad02'
ST1 = '0a000000-0000-4000-8000-00000000a501'
OWNER = '00000000-0000-4000-8000-000000000010'

def as_user(uid, q):
    claims = f"set local role authenticated; set local request.jwt.claims = '{{\"sub\":\"{uid}\",\"role\":\"authenticated\",\"aal\":\"aal2\"}}';"
    try: return sql(f"begin; {claims} {q}; commit;")
    except Exception as e: return 'ERROR ' + str(getattr(e, 'stderr', e))

with sync_playwright() as pw:
    b = pw.chromium.launch(executable_path=CHROME, headless=True, args=['--no-sandbox'])
    oc = b.new_context(viewport={'width': 1366, 'height': 900}, accept_downloads=True); o = login(oc, 'propietario.a@demo.sematec.test', mfa=True)

    # ================= 1. Editor universal =================
    go(o, BASE + '/app/academico')
    row = o.locator('tr:has-text("Técnico en")').first
    check(row.locator('a:has-text("Editar")').count() >= 1, 'Cada carrera tiene ✏️ Editar (editor completo)')
    prog = sql(f"select id from programs where organization_id = '{ORG}' order by code limit 1")
    name0 = sql(f"select name from programs where id = '{prog}'")
    go(o, f'{BASE}/app/editar/programs/{prog}?volver=/app/academico')
    check(o.locator('select[name=level]').count() == 1 and o.locator('select[name=grade_scale_id]').count() == 1 and o.locator('select[name=status]').count() == 1,
          'El formulario se arma solo: listas de opciones, relaciones y estado')
    o.fill('input[name=name]', 'Carrera editada por el propietario'); o.fill('input[name=duration_terms]', '7')
    o.click('button:has-text("Guardar cambios")'); m = status_msg(o)
    check(m.startswith('✓') and sql(f"select name || '|' || duration_terms from programs where id = '{prog}'") == 'Carrera editada por el propietario|7', f'Guardar edición ({m[:50]})')
    o.locator('[data-testid=barra-deshacer] button:has-text("Deshacer"):not([disabled])').wait_for(timeout=15000)
    o.locator('[data-testid=barra-deshacer] button:has-text("Deshacer")').click(); o.locator('[data-testid=undo-msg]').wait_for(timeout=15000)
    check(sql(f"select name from programs where id = '{prog}'") == name0, '↶ Deshacer revierte la edición del editor universal')

    # Anuncio: editar y eliminar desde el editor
    ann = sql(f"insert into announcements (organization_id, audience, title, body, author_name, created_by) values ('{ORG}', 'all', 'Anuncio a editar E2E', 'Texto', 'E2E', '{OWNER}') returning id").splitlines()[0]
    go(o, BASE + '/app/anuncios')
    card = o.locator('section.card:has-text("Anuncio a editar E2E")').first
    card.locator('a:has-text("Editar")').click(); o.wait_for_url(re.compile(r'/app/editar/announcements/'))
    o.fill('input[name=title]', 'Anuncio corregido E2E'); o.select_option('select[name=pinned]', 'true')
    o.click('button:has-text("Guardar cambios")'); status_msg(o)
    check(sql(f"select title || '|' || pinned from announcements where id = '{ann}'") == 'Anuncio corregido E2E|true', 'Anuncio editado (título y destacado)')
    o.once('dialog', lambda d: d.accept()); o.locator('button:has-text("Eliminar")').click()
    o.wait_for_url(re.compile(r'/app/anuncios'), timeout=20000)
    check(sql(f"select count(*) from announcements where id = '{ann}'") == '0', 'Eliminar desde el editor vuelve a la lista')
    go(o, BASE + '/app/papelera')
    check(o.locator('[data-testid=papelera-fila]:has-text("Anuncio corregido E2E")').count() >= 1, 'Lo eliminado queda en la Papelera')

    # Clase: fecha y hora en la zona horaria de la institución
    cs = sql(f"insert into class_sessions (organization_id, section_id, starts_at, ends_at, topic) values ('{ORG}', '{SEC}', now() - interval '5 minutes', now() + interval '85 minutes', 'Clase E2E asistencia') returning id").splitlines()[0]
    go(o, f'{BASE}/app/editar/class_sessions/{cs}')
    o.fill('input[name=topic]', 'Clase E2E asistencia'); o.fill('input[name=content_covered]' if o.locator('input[name=content_covered]').count() else 'textarea[name=content_covered]', 'Unidad 1')
    o.click('button:has-text("Guardar cambios")'); status_msg(o)
    check(sql(f"select content_covered from class_sessions where id = '{cs}'") == 'Unidad 1', 'Clase editada (contenido visto)')
    go(o, f'{BASE}/app/editar/class_sessions/{cs}')
    v = o.locator('input[name=starts_at]').input_value(); o.fill('input[name=starts_at]', v); o.click('button:has-text("Guardar cambios")'); status_msg(o)
    drift = sql(f"select abs(extract(epoch from starts_at - (now() - interval '5 minutes')))::int < 120 from class_sessions where id = '{cs}'")
    check(drift == 't', 'La hora se guarda con la zona horaria correcta (sin desfase)')

    # Seguridad del editor
    lock = as_user(OWNER, f"select owner_update('programs', '{prog}', '{{\"organization_id\":\"0a000000-0000-4000-8000-000000000002\",\"name\":\"{name0}\"}}')")
    check(sql(f"select organization_id from programs where id = '{prog}'") == ORG, 'Las columnas protegidas (institución, id, cuentas) nunca se editan')
    sec_id = sql("select id from auth.users where email = 'secretaria.a@demo.sematec.test'")
    check('propietario' in as_user(sec_id, f"select owner_update('programs', '{prog}', '{{\"name\":\"hack\"}}')"), 'La base rechaza la edición universal a quien no es propietario')
    check('administrable' in as_user(OWNER, f"select owner_update('payments', '{prog}', '{{\"amount\":1}}')"), 'Pagos no se editan con el editor universal')

    # ================= 2. Asistencia: profesor, QR y aula virtual =================
    tc = b.new_context(viewport={'width': 1280, 'height': 900}); t = login(tc, 'profesor1.a@demo.sematec.test')
    go(t, f'{BASE}/app/secciones/{SEC}?t=asistencia&clase={cs}')
    tools = t.locator('[data-testid=herramientas-clase]'); tools.wait_for(timeout=20000)
    tools.locator('button:has-text("Iniciar clase")').click(); status_msg(t)
    check(sql(f"select teacher_status || '|' || (teacher_checkin_at is not null) from class_sessions where id = '{cs}'") == 'held|true', 'Profesor marca «Iniciar clase» (clase dictada)')
    go(t, f'{BASE}/app/secciones/{SEC}?t=asistencia&clase={cs}')
    t.locator('button:has-text("Asistencia con QR")').click(); status_msg(t)
    go(t, f'{BASE}/app/secciones/{SEC}?t=asistencia&clase={cs}')
    t.locator('[data-testid=qr-asistencia] img').wait_for(timeout=15000)
    code = t.locator('[data-testid=codigo-asistencia]').inner_text().strip()
    check(re.fullmatch(r'[A-Z0-9]{6}', code) is not None, f'Se muestra el QR y el código de 6 caracteres ({code})')

    sc = b.new_context(viewport={'width': 390, 'height': 844}, is_mobile=True); s = login(sc, 'estudiante1.a@demo.sematec.test')
    go(s, f'{BASE}/app/asistencia/marcar?c={code}')
    check(s.locator('input[name=code]').input_value() == code, 'El QR abre la página con el código ya escrito (celular)')
    s.click('button:has-text("Marcar mi asistencia")'); m = status_msg(s)
    check('Asistencia registrada' in m and sql(f"select status || '|' || source from attendance_records where class_session_id = '{cs}' and student_id = '{ST1}'") == 'present|qr',
          f'El estudiante queda presente vía QR ({m[:60]})')
    s.click('button:has-text("Marcar mi asistencia")'); status_msg(s)
    check(sql(f"select count(*) from attendance_records where class_session_id = '{cs}' and student_id = '{ST1}'") == '1', 'Marcar dos veces no duplica')
    go(s, BASE + '/app/asistencia'); s.fill('input[name=code]', 'ZZZZZZ'); s.click('button:has-text("Marcar")'); m = status_msg(s)
    check('inválido' in m or 'vencido' in m, f'Código incorrecto: mensaje claro ({m[:50]})')
    cs_empty = sql(f"insert into class_sessions (organization_id, section_id, starts_at, ends_at, topic) values ('{ORG}', '{SEC_EMPTY}', now(), now() + interval '1 hour', 'Otra sección') returning id").splitlines()[0]
    prof1 = sql("select id from auth.users where email = 'profesor1.a@demo.sematec.test'")
    other = [l for l in as_user(prof1, f"select open_checkin('{cs_empty}', 10)->>'code'").splitlines() if re.fullmatch(r'[A-Z0-9]{6}', l)][0]
    go(s, BASE + '/app/asistencia'); s.fill('input[name=code]', other); s.click('button:has-text("Marcar")'); m = status_msg(s)
    check('No está inscrito' in m, 'No puede marcar en una asignatura donde no está inscrito')
    check(s.locator('text=📱 QR').count() >= 1 and s.locator('text=Porcentaje por asignatura').count() >= 1, 'El estudiante ve su asistencia y cómo se registró')
    go(s, BASE + '/app/mi'); check(s.locator('a:has-text("Marcar asistencia")').count() >= 1, 'Mi portal tiene el acceso «Marcar asistencia»')

    # Aula virtual → asistencia automática
    st2_user = sql("select id from auth.users where email = 'estudiante2.a@demo.sematec.test'")
    conf = sql(f"insert into conference_sessions (organization_id, room_id, title, session_type, scheduled_start, scheduled_end, timezone, livekit_room_name, class_session_id) values ('{ORG}', '0a000000-0000-4000-8000-00000000cf01', 'Clase virtual E2E', 'class', now() - interval '20 minutes', now() + interval '1 hour', 'America/Santiago', 'e2e-asist-' || gen_random_uuid(), '{cs}') returning id").splitlines()[0]
    sql(f"insert into conference_attendance (organization_id, session_id, user_id, participant_sid, joined_at) values ('{ORG}', '{conf}', '{st2_user}', 'PA_e2e', now() - interval '18 minutes')")
    go(t, f'{BASE}/app/secciones/{SEC}?t=asistencia&clase={cs}')
    t.locator('button:has-text("Cerrar código")').click(); status_msg(t)
    go(t, f'{BASE}/app/secciones/{SEC}?t=asistencia&clase={cs}')
    t.locator('button:has-text("Tomar asistencia desde el aula virtual")').click(); m = status_msg(t)
    st2 = sql("select id from students where user_id = (select id from auth.users where email = 'estudiante2.a@demo.sematec.test')")
    st3 = sql("select id from students where user_id = (select id from auth.users where email = 'estudiante3.a@demo.sematec.test')")
    check(sql(f"select status || '|' || source from attendance_records where class_session_id = '{cs}' and student_id = '{st2}'") == 'present|virtual', f'Quien entró al aula virtual queda presente ({m[:60]})')
    check(sql(f"select status from attendance_records where class_session_id = '{cs}' and student_id = '{st3}'") == 'absent', 'Quien no entró queda ausente')
    check(sql(f"select status || '|' || source from attendance_records where class_session_id = '{cs}' and student_id = '{ST1}'") == 'present|qr', 'No pisa lo que el estudiante ya marcó con QR')
    go(t, f'{BASE}/app/secciones/{SEC}?t=asistencia&clase={cs}')
    t.locator('button:has-text("Terminar clase")').click(); status_msg(t)
    check(sql(f"select teacher_checkout_at is not null from class_sessions where id = '{cs}'") == 't', 'Profesor marca «Terminar clase»')
    go(t, BASE + '/app/asistencia')
    check(t.locator('[data-testid=tabla-asistencia]').count() == 1, 'El profesor ve los reportes de sus secciones')

    # ================= 3. Reportes, alertas, personal y Excel =================
    emp = sql("select id from employees where organization_id = '0a000000-0000-4000-8000-000000000001' and status = 'active' limit 1")
    sql(f"insert into staff_attendance (organization_id, employee_id, work_date, check_in, check_out) values ('{ORG}', '{emp}', current_date - 1, (current_date - 1) + time '08:30', (current_date - 1) + time '17:30') on conflict do nothing")
    go(o, BASE + '/app/asistencia')
    check(o.locator('a:has-text("Asistencia")').count() >= 1 and o.locator('[data-testid=tabla-asistencia] tr').count() >= 3, 'Propietario: asistencia de estudiantes por sección')
    go(o, BASE + '/app/asistencia?t=alertas')
    check(o.locator('text=bajo').count() >= 1, 'Alertas: estudiantes bajo el mínimo de asistencia')
    go(o, BASE + '/app/asistencia?t=profesores')
    check(o.locator('tr:has-text("Dictadas")').count() == 1 and o.locator('td:has-text(" h")').count() >= 1, 'Clases dictadas y horas por profesor')
    go(o, BASE + '/app/asistencia?t=personal')
    check(o.locator('text=Marcajes').count() == 1 and o.locator('td:has-text("9")').count() >= 1, 'Personal: días, horas y marcajes')
    with o.expect_download() as dl:
        o.locator('[data-testid=exportar]').click()
    path = dl.value.path(); data = open(path, encoding='utf-8-sig').read()
    check(data.startswith('Funcionario;Cargo;') and len(data.splitlines()) >= 2, 'Descarga a Excel (CSV con columnas en español)')
    go(o, BASE + '/app/asistencia?t=estudiantes')
    with o.expect_download() as dl:
        o.locator('[data-testid=exportar]').click()
    data = open(dl.value.path(), encoding='utf-8-sig').read()
    check('Asistencia %' in data.splitlines()[0] and len(data.splitlines()) >= 3, 'Excel de asistencia de estudiantes')

    # ================= 4. Actualizar el sistema =================
    go(o, BASE + '/app/academico')
    check(o.locator('button:has-text("Refrescar")').count() == 1, 'Botón 🔄 Refrescar en todas las páginas')
    check(o.locator('a:has-text("Actualizar sistema")').count() == 0, 'El propietario de una institución no ve «Actualizar sistema» (es de la plataforma)')
    ac = b.new_context(viewport={'width': 1366, 'height': 900}); a = login(ac, 'superadmin@demo.sematec.test', mfa=True)
    check(a.locator('a:has-text("Actualizar sistema")').count() >= 1, 'Menú «Actualizar sistema» para el superadministrador')
    sql("create schema if not exists supabase_migrations; create table if not exists supabase_migrations.schema_migrations (version text primary key, statements text[], name text)")
    sql("delete from supabase_migrations.schema_migrations")
    for f in sorted(os.listdir(os.path.join(os.path.dirname(__file__), '../../supabase/migrations'))):
        if f.endswith('.sql') and not f.startswith('20261109000200'):
            sql(f"insert into supabase_migrations.schema_migrations (version, name) values ('{f.split('_')[0]}', 'x')")
    go(a, BASE + '/app/actualizar')
    check(a.locator('[data-testid=pendientes]').inner_text().strip().startswith('Editar asistencia'), 'Muestra las mejoras pendientes')
    a.once('dialog', lambda d: d.accept()); a.locator('button:has-text("Instalar 1 mejora")').click()
    a.locator('[data-testid=al-dia]').wait_for(timeout=60000)
    check(sql("select count(*) from supabase_migrations.schema_migrations where version = '20261109000200'") == '1', '⬆ Instala la mejora con un botón')
    go(a, BASE + '/app/actualizar')
    check(a.locator('[data-testid=al-dia]').count() == 1, 'Queda «✓ Al día»')
    check('superadministrador' in as_user(sec_id, "select installed_migrations()"), 'Solo el superadministrador ve las mejoras instaladas')
    import json, urllib.request
    v = json.loads(urllib.request.urlopen(BASE + '/api/version').read())
    check(bool(v.get('version')), f'Versión publicada disponible para el aviso «Actualizar ahora» ({v.get("version")})')
    o.route('**/api/version', lambda r: r.fulfill(status=200, content_type='application/json', body='{"version":"nueva-version"}'))
    go(o, BASE + '/app/academico')
    o.locator('[data-testid=version-nueva]').wait_for(timeout=15000)
    check(o.locator('[data-testid=version-nueva] button:has-text("Actualizar ahora")').count() == 1, 'Aviso «Hay una versión nueva · Actualizar ahora»')
    b.close()

print(f"\n{sum(1 for r in results if r[0])}/{len(results)} verificaciones OK")
