"""
Pruebas de punta a punta de SEMATEC ACADEMY en un navegador real (Chrome).
Requiere la app corriendo (BASE_URL), Supabase con migraciones + seed + usuarios demo,
y LiveKit para la prueba de videoconferencia.
    python3 tests/e2e/e2e.py
"""
import os, re, sys, time, json, subprocess, pyotp
from playwright.sync_api import sync_playwright, expect

BASE = os.environ.get('BASE_URL', 'http://localhost:3000')
PASS = os.environ.get('DEMO_PASSWORD', 'Sematec-Demo-2026')
SHOTS = os.environ.get('SHOTS', 'docs/capturas')
PSQL = os.environ.get('PSQL', 'psql -h /tmp/pg -p 54322 -U postgres -d academy -tAc')
CHROME = os.environ.get('CHROME', '/usr/bin/google-chrome')
results = []
secrets = {}

def sql(q):
    return subprocess.run(PSQL.split() + [q], capture_output=True, text=True, check=True).stdout.strip()

def check(cond, msg):
    results.append((bool(cond), msg))
    print(('OK   ' if cond else 'FALLÓ ') + msg, flush=True)
    if not cond: raise AssertionError(msg)

def shot(page, name):
    os.makedirs(SHOTS, exist_ok=True)
    page.screenshot(path=f'{SHOTS}/{name}.png', full_page=True)

def login(ctx, email, mfa=False):
    page = ctx.new_page()
    go(page, f'{BASE}/login')
    page.fill('input[name=email]', email)
    page.fill('input[name=password]', PASS)
    page.click('button[type=submit]')
    if mfa:
        page.wait_for_url(re.compile(r'/mfa'), timeout=20000)
        if email not in secrets:
            page.wait_for_selector('code', timeout=20000)
            secrets[email] = page.locator('code').inner_text().strip()
        page.fill('input[inputmode=numeric]', pyotp.TOTP(secrets[email]).now())
        page.click('button:has-text("Verificar")')
    page.wait_for_url(re.compile(r'/app'), timeout=20000)
    return page

def go(page, url):
    page.goto(url)
    page.wait_for_load_state('networkidle')

def sel_re(page, selector, pattern):
    """Selecciona la opción cuyo texto contiene el patrón."""
    value = page.eval_on_selector(selector, '(el, pat) => { const o = [...el.options].find(o => new RegExp(pat).test(o.textContent)); return o ? o.value : null; }', pattern)
    if value is None: raise AssertionError(f'Opción no encontrada: {pattern} en {selector}')
    page.select_option(selector, value)

def status_msg(page):
    loc = page.locator('[role=status]').last
    loc.wait_for(timeout=20000)
    return loc.inner_text()

def main():
    with sync_playwright() as p:
        browser = p.chromium.launch(executable_path=CHROME, headless=True,
            args=['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--no-sandbox'])
        new = lambda: browser.new_context(viewport={'width': 1440, 'height': 900}, permissions=['camera', 'microphone'])

        # 1. Inicio de sesión real: credenciales incorrectas rechazadas y registradas
        c = new(); page = c.new_page(); page.goto(f'{BASE}/app')
        check('/login' in page.url, 'Ruta protegida redirige al inicio de sesión')
        page.fill('input[name=email]', 'secretaria.a@demo.sematec.test'); page.fill('input[name=password]', 'clave-incorrecta')
        page.click('button[type=submit]')
        check('incorrectos' in status_msg(page), 'Credenciales incorrectas rechazadas con mensaje claro')
        check(int(sql("select count(*) from system_events where event_type='login_failed' and details->>'email'='secretaria.a@demo.sematec.test'")) >= 1,
              'Intento fallido registrado en eventos de seguridad')
        shot(page, '01_login'); c.close()

        # 2. Secretaría registra estudiante (persistencia en la nube)
        c1 = new(); page = login(c1, 'secretaria.a@demo.sematec.test')
        shot(page, '02_inicio_secretaria')
        go(page, f'{BASE}/app/estudiantes?nuevo=1')
        page.fill('input[name=student_code]', 'EST-E2E1'); page.fill('input[name=first_names]', 'Camila')
        page.fill('input[name=last_names]', 'Prueba Navegador'); page.fill('input[name=id_document_number]', 'E2E-0001')
        page.fill('input[name=email]', 'camila.e2e@demo.sematec.test')
        page.select_option('select[name=campus_id]', label='Sede Santiago (STGO)')
        page.click('button:has-text("Registrar estudiante")')
        check('registrado' in status_msg(page), 'Estudiante registrado desde el formulario')
        check(sql("select count(*) from students where student_code='EST-E2E1'") == '1', 'El registro existe en PostgreSQL')
        page.reload(); expect(page.locator('text=Prueba Navegador, Camila')).to_be_visible()
        shot(page, '03_estudiantes')
        # validación
        go(page, f'{BASE}/app/estudiantes?nuevo=1')
        page.fill('input[name=student_code]', 'EST-E2E1'); page.fill('input[name=first_names]', 'Dup'); page.fill('input[name=last_names]', 'Licado')
        page.fill('input[name=id_document_number]', 'E2E-0002'); page.click('button:has-text("Registrar estudiante")')
        check('Ya existe' in status_msg(page), 'Código duplicado rechazado con mensaje claro')

        # 3. Otro dispositivo (contexto independiente) ve el mismo dato
        c2 = new(); page2 = login(c2, 'secretaria.a@demo.sematec.test')
        go(page2, f'{BASE}/app/estudiantes?q=Navegador')
        expect(page2.locator('text=Prueba Navegador, Camila')).to_be_visible()
        check(True, 'Estudiante visible desde otro dispositivo/sesión')
        c2.close()

        # 4. Sin conexión: la operación no se muestra como guardada
        go(page, f'{BASE}/app/estudiantes?nuevo=1')
        page.fill('input[name=student_code]', 'EST-E2E9'); page.fill('input[name=first_names]', 'Sin'); page.fill('input[name=last_names]', 'Conexion')
        page.fill('input[name=id_document_number]', 'E2E-0009')
        c1.set_offline(True); page.click('button:has-text("Registrar estudiante")')
        msg = status_msg(page); c1.set_offline(False)
        check('NO fue guardada' in msg, 'Sin internet: mensaje claro de que NO se guardó')
        check(sql("select count(*) from students where student_code='EST-E2E9'") == '0', 'Sin internet: nada se guardó en la base')
        shot(page, '04_sin_conexion')

        # Secretaría (sede Santiago) no ve estudiante de Valparaíso y no ve finanzas
        go(page, f'{BASE}/app/estudiantes?q=Tres')
        check(page.locator('text=Tres, Estudiante').count() == 0, 'Restricción por sede aplicada en la interfaz')
        r = page.goto(f'{BASE}/app/finanzas'); check(r.status == 404, 'Secretaría no accede a Finanzas (404)')
        c1.close()

        # 5. Propietario: MFA obligatoria
        c3 = new(); page = login(c3, 'propietario.a@demo.sematec.test', mfa=True)
        check(sql("select count(*) from auth.mfa_factors where status='verified' and user_id='00000000-0000-4000-8000-000000000010'") == '1',
              'MFA (TOTP) inscrita y verificada para administrador')
        shot(page, '05_inicio_propietario')
        # Matrícula con arancel
        go(page, f'{BASE}/app/matriculas')
        sel_re(page, 'select[name=student_id]', 'Prueba Navegador')
        sel_re(page, 'select[name=program_id]', 'TIN')
        page.fill('input[name=amount]', '1200000'); page.fill('input[name=installments]', '4'); page.fill('input[name=first_due]', '2026-08-05')
        page.click('button:has-text("Matricular")')
        m = status_msg(page); check('Matrícula registrada' in m and 'cuotas generados' in m, 'Matrícula con arancel en 4 cuotas')
        shot(page, '06_matriculas')
        # Pago parcial
        go(page, f'{BASE}/app/finanzas/pagos')
        sel_re(page, 'select[name=student_id]', 'Prueba Navegador')
        page.fill('input[name=amount]', '450000'); page.select_option('select[name=method]', 'bank_transfer')
        page.fill('input[name=external_reference]', 'E2E-TRX-1'); page.click('button:has-text("Registrar pago")')
        check('Recibo N°' in status_msg(page), 'Pago registrado con recibo correlativo')
        sid = sql("select id from students where student_code='EST-E2E1'")
        go(page, f'{BASE}/app/finanzas/cuenta/{sid}')
        paid = sql(f"select string_agg(paid::int::text, ',' order by number) from installment_balances where student_id='{sid}'")
        check(paid == '300000,150000,0,0', f'Imputación a cuotas más antiguas ({paid})')
        shot(page, '07_estado_cuenta')
        # Pago duplicado
        go(page, f'{BASE}/app/finanzas/pagos')
        sel_re(page, 'select[name=student_id]', 'Prueba Navegador')
        page.fill('input[name=amount]', '1000'); page.select_option('select[name=method]', 'bank_transfer')
        page.fill('input[name=provider]', ''); page.fill('input[name=external_reference]', 'E2E-TRX-1'); page.click('button:has-text("Registrar pago")')
        check('Ya existe' in status_msg(page) or 'repetido' in status_msg(page), 'Transacción duplicada rechazada')
        # Anulación con motivo
        go(page, f'{BASE}/app/finanzas/cuenta/{sid}')
        page.once('dialog', lambda d: d.accept())
        page.fill('input[placeholder="Motivo de anulación"]', 'Transferencia devuelta por el banco')
        page.click('button:has-text("Anular")')
        check('anulado' in status_msg(page), 'Pago anulado con reverso')
        check(sql("select status from payments where external_reference='E2E-TRX-1'") == 'voided', 'Pago queda anulado (no borrado) en la base')
        # Usuarios y roles: crear profesor con acceso
        go(page, f'{BASE}/app/usuarios')
        page.fill('input[name=email]', 'coordinador.e2e@demo.sematec.test'); page.fill('input[name=full_name]', 'Coordinador E2E')
        page.select_option('select[name=role]', label='Coordinador académico')
        page.click('button:has-text("Asignar rol")')
        m = status_msg(page); check('contraseña temporal' in m, 'Usuario nuevo creado con rol y contraseña temporal')
        secrets['coord_pass'] = m.split(': ')[-1].strip()
        shot(page, '08_usuarios')
        # Auditoría
        go(page, f'{BASE}/app/auditoria'); page.click('button:has-text("Verificar integridad")')
        check('Cadena íntegra' in status_msg(page), 'Auditoría: cadena íntegra verificada desde la interfaz')
        shot(page, '09_auditoria')
        c3.close()

        # 6. Profesora: asistencia, notas y cierre de acta (sección Bases de Datos)
        sec = '0a000000-0000-4000-8000-00000000ad03'
        cm = new(); page = login(cm, 'matriculas.a@demo.sematec.test')
        for code in ['EST-0001', 'EST-0002']:
            go(page, f'{BASE}/app/secciones/{sec}')
            sel_re(page, 'select[name=student_id]', code)
            page.click('button:has-text("Inscribir")')
            check('inscrito' in status_msg(page), f'Matrículas inscribe {code} en Bases de Datos')
        cm.close()
        ct = new(); page = login(ct, 'profesor2.a@demo.sematec.test')
        go(page, f'{BASE}/app/docencia'); shot(page, '10_mis_secciones')
        go(page, f'{BASE}/app/secciones/{sec}?t=asistencia')
        page.fill('input[name=start]', '10:00'); page.fill('input[name=end]', '11:30'); page.fill('input[name=topic]', 'Modelo relacional')
        page.click('button:has-text("Registrar clase")'); check('libro de clases' in status_msg(page), 'Clase registrada en libro de clases')
        page.reload()
        page.locator('input[type=radio][value=absent]').nth(1).check()
        page.click('button:has-text("Guardar asistencia")'); check('Asistencia guardada' in status_msg(page), 'Asistencia guardada')
        shot(page, '11_asistencia')
        go(page, f'{BASE}/app/secciones/{sec}?t=notas')
        for name, w in [('Prueba 1', '40'), ('Proyecto', '60')]:
            page.fill('input[name=name]', name); page.fill('input[name=weight_pct]', w); page.check('input[name=published]')
            page.click('button:has-text("Crear evaluación")'); check('creada' in status_msg(page), f'Evaluación {name} ({w} %)')
            page.reload()
        inputs = page.locator('input[name^="g_"]')
        vals = ['6.5', '5.5', '3.0', '3.5']   # filas por apellido: «Dos» (EST-0002) y luego «Uno» (EST-0001)
        for i, v in enumerate(vals): inputs.nth(i).fill(v)
        page.click('button:has-text("Guardar notas")'); check('4 notas guardadas' in status_msg(page), 'Planilla de notas guardada')
        inputs.nth(0).fill('9'); page.click('button:has-text("Guardar notas")')
        check('fuera de la escala' in status_msg(page), 'Nota fuera de escala rechazada')
        page.reload(); page.once('dialog', lambda d: d.accept())
        page.click('button:has-text("Cerrar acta")'); check('Acta cerrada' in status_msg(page), 'Acta cerrada por la profesora')
        page.reload(); shot(page, '12_acta_notas')
        fin = sql(f"select string_agg(final_grade::text||':'||result, ',' order by student_id) from academic_records where section_id='{sec}'")
        check(set(fin.split(',')) == {'5.90:approved', '3.30:failed'}, f'Nota final ponderada y resultado ({fin})')
        ct.close()

        # 7. Estudiante: portal
        cs = new(); page = login(cs, 'estudiante1.a@demo.sematec.test')
        go(page, f'{BASE}/app/mi'); expect(page.locator('text=Modelo').or_(page.locator('text=Bases de Datos')).first).to_be_visible()
        check(page.locator('text=Proyecto (60 %)').count() == 1, 'Estudiante ve sus notas publicadas en el portal')
        shot(page, '13_portal_estudiante')
        r = page.goto(f'{BASE}/app/estudiantes'); check(r.status == 404, 'Estudiante no accede al listado de estudiantes')
        cs.close()

        # 8. Certificado y verificación pública
        c4 = new(); page = login(c4, 'secretaria.a@demo.sematec.test')
        go(page, f'{BASE}/app/certificados')
        sel_re(page, 'select[name=template_id]', 'Aprobación de asignatura')
        sel_re(page, 'select[name=student_id]', 'EST-0002')
        sel_re(page, 'select[name=course_id]', 'BDD101')
        page.click('button:has-text("Emitir")'); check('emitido' in status_msg(page), 'Certificado emitido tras validar aprobación')
        sel_re(page, 'select[name=template_id]', 'Aprobación de asignatura')
        sel_re(page, 'select[name=student_id]', 'EST-0001')
        sel_re(page, 'select[name=course_id]', 'BDD101')
        page.click('button:has-text("Emitir")'); check('no está aprobada' in status_msg(page), 'Certificado rechazado si la asignatura no está aprobada')
        page.reload(); page.locator('a:has-text("Certificado de aprobación")').first.click()
        page.wait_for_url(re.compile(r'/app/certificados/')); shot(page, '14_certificado')
        code = sql("select verification_code from certificates order by issued_at desc limit 1")
        c4.close()
        anon = new(); page = anon.new_page(); page.goto(f'{BASE}/verificar/{code}')
        check(page.locator('text=Certificado auténtico y vigente').count() == 1, 'Verificación pública (sin sesión) confirma autenticidad')
        shot(page, '15_verificacion_publica')
        go(page, f'{BASE}/verificar/AAAA-BBBB-CCCC-DDDD'); check(page.locator('text=Código no encontrado').count() == 1, 'Código falso detectado')
        anon.close()

        # 9. Videoconferencia real con LiveKit (dos navegadores con cámara/micrófono simulados)
        c5 = new(); page = login(c5, 'profesor2.a@demo.sematec.test')
        go(page, f'{BASE}/app/conferencias')
        sel_re(page, 'form:has(button:has-text("Crear sala")) select[name=section_id]', 'BDD101')
        page.fill('form:has(button:has-text("Crear sala")) input[name=name]', 'Aula virtual BDD E2E')
        page.click('button:has-text("Crear sala")'); check('Sala creada' in status_msg(page), 'Profesora crea aula virtual de su sección')
        page.reload()
        page.select_option('select[name=room_id]', label='Aula virtual BDD E2E')
        page.fill('form:has(button:has-text("Programar")) input[name=title]', 'Clase en vivo E2E')
        now = time.localtime(time.time() - 3 * 3600)  # hora de Santiago aproximada (UTC-3)
        page.fill('input[name=date]', time.strftime('%Y-%m-%d', time.gmtime(time.time() - 3 * 3600)))
        page.fill('form:has(button:has-text("Programar")) input[name=start]', time.strftime('%H:%M', time.gmtime(time.time() - 3 * 3600 - 300)))
        page.fill('form:has(button:has-text("Programar")) input[name=end]', time.strftime('%H:%M', time.gmtime(time.time() - 3 * 3600 + 3300)))
        page.click('button:has-text("Programar")'); check('programada' in status_msg(page), 'Sesión programada')
        sess = sql("select id from conference_sessions where title='Clase en vivo E2E'")
        go(page, f'{BASE}/app/conferencias/sala/{sess}'); page.click('button:has-text("Entrar a la sala")')
        page.wait_for_selector('.lk-video-conference', timeout=30000)
        c6 = new(); page_s = login(c6, 'estudiante1.a@demo.sematec.test')
        go(page_s, f'{BASE}/app/conferencias/sala/{sess}'); page_s.click('button:has-text("Entrar a la sala")')
        page_s.wait_for_selector('.lk-video-conference', timeout=30000)
        page_s.locator('button.lk-button:has-text("Camera")').first.click(); time.sleep(1)
        page.locator('button.lk-button:has-text("Camera")').first.click()
        page.wait_for_function("document.querySelectorAll('.lk-participant-tile').length >= 2", timeout=30000)
        time.sleep(4)
        shot(page, '16_videoconferencia_profesor'); shot(page_s, '17_videoconferencia_estudiante')
        check(page.locator('.lk-participant-tile').count() >= 2, 'Profesora y estudiante conectados por audio/video en LiveKit')
        time.sleep(3)
        joined = sql(f"select count(distinct user_id) from conference_attendance where session_id='{sess}'")
        check(joined == '2', f'Webhook de LiveKit registró entradas en la base ({joined} participantes)')
        # estudiante de otra institución no obtiene token
        c7 = new(); pb = login(c7, 'estudiante1.b@demo.sematec.test')
        resp = pb.request.post(f'{BASE}/api/livekit/token', data=json.dumps({'session': sess}), headers={'Content-Type': 'application/json'})
        check(resp.status == 403, 'Usuario de otra institución no obtiene token de la sala')
        c7.close()
        go(page, f'{BASE}/app/conferencias/{sess}'); page.once('dialog', lambda d: d.accept())
        page.click('button:has-text("Finalizar")'); check('Sesión finalizada' in status_msg(page), 'Profesora finaliza la sesión y se calcula asistencia')
        c5.close(); c6.close()
        browser.close()

    ok = sum(1 for r in results if r[0])
    print(f'\nVerificaciones de punta a punta: {ok}/{len(results)}')

if __name__ == '__main__':
    try:
        main()
    except Exception as e:
        print('ERROR:', e); ok = sum(1 for r in results if r[0]); print(f'\nVerificaciones de punta a punta: {ok}/{len(results)} (interrumpido)'); sys.exit(1)
