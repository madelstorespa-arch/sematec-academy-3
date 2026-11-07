"""Calendario, reservas de salas/recursos, personal y RR. HH., inventario."""
import re, sys, os, datetime
sys.path.insert(0, os.path.dirname(__file__))
from e2e import BASE, CHROME, sql, check, shot, login, status_msg, go, sel_re, results
from playwright.sync_api import sync_playwright

sql("insert into employees (organization_id, user_id, employee_code, first_names, last_names, id_document_country, id_document_type, id_document_number, email, position) values ('0a000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000011','EMP-1','Secretaria','Académica','CL','RUN','99.999.999-9','secretaria.a@demo.sematec.test','Secretaria') on conflict do nothing")
sql("insert into section_enrollments (organization_id, section_id, student_id, enrollment_id) select '0a000000-0000-4000-8000-000000000001', '0a000000-0000-4000-8000-00000000ad01', student_id, id from enrollments where student_id='0a000000-0000-4000-8000-00000000a501' limit 1 on conflict do nothing")
d = datetime.date.today()
nxt_mon = d + datetime.timedelta(days=(7 - d.weekday()) % 7 or 7)
tomorrow = d + datetime.timedelta(days=1)
with sync_playwright() as pw:
    b = pw.chromium.launch(executable_path=CHROME, headless=True, args=['--no-sandbox'])
    sc = b.new_context(viewport={'width': 1366, 'height': 900}); s = login(sc, 'secretaria.a@demo.sematec.test')
    # Calendario
    go(s, BASE + '/app/calendario'); s.click('summary:has-text("Agregar evento")')
    s.fill('input[name=title]', 'Feriado E2E'); s.select_option('select[name=kind]', 'feriado'); s.fill('input[name=start]', f'{tomorrow}T00:00'); s.check('input[name=all_day]')
    s.click('button:has-text("Agregar")'); check('calendario' in status_msg(s), 'Secretaría agrega un feriado al calendario')
    go(s, BASE + '/app/calendario'); check(s.locator('text=Feriado E2E').count() >= 1, 'El feriado aparece en el calendario'); shot(s, 'org_calendario')
    # Reservas
    go(s, BASE + '/app/reservas'); s.click('summary:has-text("Agregar equipo")') if s.locator('summary:has-text("Agregar equipo")').count() else None
    s.fill('input[name=code]', 'PROY-01'); s.fill('input[name=name]', 'Proyector Epson'); s.select_option('select[name=kind]', 'proyector'); s.click('button:has-text("Agregar")')
    check('agregado' in status_msg(s), 'Se registra un proyector reservable')
    go(s, BASE + '/app/reservas'); sel_re(s, 'select[name=target]', 'A101'); s.fill('input[name=day]', str(tomorrow)); s.fill('input[name=start]', '15:00'); s.fill('input[name=end]', '16:30')
    s.fill('input[name=purpose]', 'Reunión de apoderados'); s.click('button:has-text("Reservar")'); check('confirmada' in status_msg(s), 'Reserva de sala confirmada')
    go(s, BASE + '/app/reservas'); sel_re(s, 'select[name=target]', 'A101'); s.fill('input[name=day]', str(tomorrow)); s.fill('input[name=start]', '16:00'); s.fill('input[name=end]', '17:00')
    s.fill('input[name=purpose]', 'Choque'); s.click('button:has-text("Reservar")'); check('Ya existe una reserva' in status_msg(s), 'Bloquea doble reserva de la misma sala')
    go(s, BASE + '/app/reservas'); sel_re(s, 'select[name=target]', 'A101'); s.fill('input[name=day]', str(nxt_mon)); s.fill('input[name=start]', '09:00'); s.fill('input[name=end]', '09:30')
    s.fill('input[name=purpose]', 'Choque clase'); s.click('button:has-text("Reservar")'); m = status_msg(s)
    check('clases programadas' in m or nxt_mon > datetime.date(2026, 12, 20), 'Bloquea reservar una sala con clases a esa hora')
    shot(s, 'org_reservas')
    # Personal: marcar asistencia y pedir permiso
    go(s, BASE + '/app/personal'); s.click('button:has-text("Marcar entrada")'); check('Entrada registrada' in status_msg(s), 'Funcionaria marca entrada')
    go(s, BASE + '/app/personal'); s.fill('input[name=starts_on]', str(d + datetime.timedelta(days=20))); s.fill('input[name=ends_on]', str(d + datetime.timedelta(days=22)))
    s.click('button:has-text("Enviar solicitud")'); check('enviada' in status_msg(s), 'Funcionaria solicita vacaciones')
    # Propietaria: RR. HH. e inventario
    oc = b.new_context(viewport={'width': 1366, 'height': 900}); o = login(oc, 'propietario.a@demo.sematec.test', mfa=True)
    go(o, BASE + '/app/personal'); check(o.locator('text=Secretaria, Académica').count() + o.locator('text=Académica, Secretaria').count() >= 1, 'RR. HH. ve al funcionario y su marca de hoy')
    o.click('button:has-text("Aprobar")'); check('aprobada' in status_msg(o), 'RR. HH. aprueba las vacaciones'); shot(o, 'org_personal')
    go(o, BASE + '/app/inventario'); o.click('summary:has-text("Ingresar bien")'); o.fill('input[name=code]', 'INV-0001'); o.fill('input[name=name]', 'Notebook HP 240')
    o.fill('input[name=purchase_value]', '450000'); o.click('button:has-text("Ingresar")'); check('ingresado' in status_msg(o), 'Bien ingresado al inventario')
    go(o, BASE + '/app/inventario'); row = o.locator('tr:has-text("INV-0001")')
    row.locator('select[name=status]').select_option('en_reparacion'); sel_re(o, 'tr:has-text("INV-0001") select[name=room_id]', 'A101')
    row.locator('input[name=assigned_to]').fill('Profesor Uno'); row.locator('button:has-text("✓")').click(); check('historial' in status_msg(o), 'Bien trasladado, asignado y enviado a reparación')
    go(o, BASE + '/app/inventario'); o.click('tr:has-text("INV-0001") >> text=Historial'); o.wait_for_selector('text=Historial del bien')
    check(o.locator('text=Ingreso al inventario').count() == 1 and o.locator('text=operativo → en_reparacion').count() == 1, 'Historial automático de movimientos'); shot(o, 'org_inventario')
    # Estudiante: calendario con horario, sin acceso a inventario/reservas
    ec = b.new_context(viewport={'width': 390, 'height': 844}, is_mobile=True); e = login(ec, 'estudiante1.a@demo.sematec.test')
    go(e, BASE + '/app/calendario'); check(e.locator('text=Mi horario semanal').count() == 1 and e.locator('text=Feriado E2E').count() >= 1, 'Estudiante ve su horario semanal y el feriado'); shot(e, 'org_calendario_celular')
    r = e.request.get(BASE + '/app/inventario'); check(r.status == 404, 'Estudiante no puede ver el inventario')
    b.close()
print(f"\n{sum(1 for ok, _ in results if ok)}/{len(results)} pruebas OK")
