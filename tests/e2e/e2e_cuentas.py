"""Cuentas con contraseña elegida por el administrador: estudiante, profesor y funcionario."""
import re, sys, os
sys.path.insert(0, os.path.dirname(__file__))
from e2e import BASE, CHROME, sql, check, shot, login, status_msg, go, results
from playwright.sync_api import sync_playwright

PW1, PW2 = 'Alumno2026Clave', 'Docente2026Clave'
sql("insert into teachers (organization_id, teacher_code, first_names, last_names, id_document_country, id_document_type, id_document_number, email) values ('0a000000-0000-4000-8000-000000000001','DOC-9','Marc','Vertisma','CL','RUN','11.222.333-4','marc.v@demo.sematec.test')")
sql("insert into students (organization_id, campus_id, student_code, first_names, last_names, id_document_country, id_document_type, id_document_number, email) values ('0a000000-0000-4000-8000-000000000001','0a000000-0000-4000-8000-0000000000c1','EST-9','Nueva','Alumna','CL','RUN','22.333.444-5','nueva.alumna@demo.sematec.test')")
sql("insert into employees (organization_id, employee_code, first_names, last_names, id_document_country, id_document_type, id_document_number, email, position) values ('0a000000-0000-4000-8000-000000000001','EMP-9','Ana','Contable','CL','RUN','33.444.555-6','ana.contable@demo.sematec.test','Contadora')")
def can_login(email, pw):
    c = b.new_context(); p = c.new_page(); go(p, BASE + '/login'); p.fill('input[name=email]', email); p.fill('input[name=password]', pw); p.click('button[type=submit]')
    try: p.wait_for_url(re.compile(r'/(app|mfa)'), timeout=15000); ok = True
    except Exception: ok = False
    c.close(); return ok
with sync_playwright() as pw:
    b = pw.chromium.launch(executable_path=CHROME, headless=True, args=['--no-sandbox'])
    oc = b.new_context(viewport={'width': 1366, 'height': 900}); o = login(oc, 'propietario.a@demo.sematec.test', mfa=True)
    go(o, BASE + '/app/estudiantes?q=Alumna'); row = o.locator('tr:has-text("Alumna")')
    row.locator('input[name=password]').fill('corta'); row.locator('button:has-text("Crear cuenta")').click()
    check(o.locator('input[name=password]:invalid').count() >= 1 or 'al menos 10' in status_msg(o), 'Rechaza contraseñas débiles')
    row.locator('input[name=password]').fill(PW1); row.locator('button:has-text("Crear cuenta")').click()
    m = status_msg(o); print('   ', m); check('la que usted escribió' in m and PW1 not in m, 'Estudiante: cuenta creada con la contraseña elegida')
    check(can_login('nueva.alumna@demo.sematec.test', PW1), 'La estudiante entra con su contraseña')
    go(o, BASE + '/app/profesores'); row = o.locator('tr:has-text("Vertisma")'); row.locator('input[name=password]').fill(PW2); row.locator('button:has-text("Crear cuenta")').click()
    check('la que usted escribió' in status_msg(o), 'Profesor: cuenta creada con la contraseña elegida')
    check(can_login('marc.v@demo.sematec.test', PW2), 'El profesor entra con su contraseña')
    go(o, BASE + '/app/profesores'); row = o.locator('tr:has-text("Vertisma")'); row.locator('input[name=password]').fill('NuevaClave2026x'); row.locator('button:has-text("Cambiar")').click()
    check('actualizada' in status_msg(o), 'Cambio de contraseña del profesor'); check(can_login('marc.v@demo.sematec.test', 'NuevaClave2026x'), 'Entra con la contraseña nueva')
    go(o, BASE + '/app/personal'); o.click('tr:has-text("Contable") >> text=Crear cuenta'); f = o.locator('tr:has-text("Contable") form')
    f.locator('select[name=role]').select_option('secretaria'); f.locator('input[name=password]').fill('Funcionaria2026'); f.locator('button:has-text("Crear cuenta")').click()
    check('la que usted escribió' in status_msg(o), 'Funcionaria: cuenta y rol creados'); shot(o, 'cuentas_personal')
    check(can_login('ana.contable@demo.sematec.test', 'Funcionaria2026'), 'La funcionaria entra con su contraseña')
    go(o, BASE + '/app/estudiantes'); shot(o, 'cuentas_estudiantes')
    b.close()
print(f"\n{sum(1 for ok, _ in results if ok)}/{len(results)} pruebas OK")
