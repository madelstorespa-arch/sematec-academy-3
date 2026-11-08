"""Centro de Ciberseguridad: panorama, alertas por intentos fallidos, sesiones, bloqueo inmediato e incidentes."""
import re, sys, os
sys.path.insert(0, os.path.dirname(__file__))
from e2e import BASE, CHROME, sql, check, shot, login, status_msg, go, results
from playwright.sync_api import sync_playwright

with sync_playwright() as pw:
    b = pw.chromium.launch(executable_path=CHROME, headless=True, args=['--no-sandbox'])
    # Intentos fallidos contra una cuenta de la institución
    a = b.new_context().new_page()
    for _ in range(3):
        go(a, BASE + '/login'); a.fill('input[name=email]', 'tesoreria.a@demo.sematec.test'); a.fill('input[name=password]', 'Incorrecta12345'); a.click('button[type=submit]'); a.wait_for_timeout(600)
    sc = b.new_context(); s = login(sc, 'secretaria.a@demo.sematec.test')  # sesión activa a revisar
    oc = b.new_context(viewport={'width': 1366, 'height': 900}); o = login(oc, 'propietario.a@demo.sematec.test', mfa=True)
    go(o, BASE + '/app/ciberseguridad')
    check(o.locator('text=Nivel de seguridad').count() == 1 and o.locator('text=Administradores sin MFA').count() == 1, 'Panorama con nivel de seguridad y puntos por resolver')
    check(o.locator('text=Configuración del servidor').count() == 1 and o.locator('text=service_role').count() == 0, 'Revisa la configuración sin mostrar claves')
    o.click('button:has-text("Verificar integridad")'); m = status_msg(o); check('Integridad correcta' in m, f'Verifica auditoría y certificados ({m[:60]})')
    shot(o, 'ciber_panorama')
    go(o, BASE + '/app/ciberseguridad?t=alertas&dias=1')
    check(o.locator('text=Inicio de sesión fallido').count() >= 3 and o.locator('text=tesoreria.a@demo.sematec.test').count() >= 1, 'Alertas: intentos fallidos con cuenta, IP y dispositivo')
    go(o, BASE + '/app/ciberseguridad?t=sesiones')
    row = o.locator('li:has-text("secretaria.a@demo.sematec.test")').first
    check(row.count() == 1, 'Sesiones activas de la institución')
    shot(o, 'ciber_sesiones')
    row.locator('input[name=reason]').fill('Prueba de bloqueo'); o.once('dialog', lambda d: d.accept())
    row.locator('button:has-text("Bloquear")').click(); m = status_msg(o); check('Cuenta bloqueada' in m, 'Bloquea la cuenta desde el panel')
    r = s.request.get(BASE + '/app/estudiantes')
    check(sql("select status from profiles where email = 'secretaria.a@demo.sematec.test'") == 'locked' and 'Registrar estudiante' not in r.text(), 'La cuenta bloqueada pierde el acceso de inmediato')
    go(o, BASE + '/app/ciberseguridad?t=accesos')
    lr = o.locator('li:has-text("secretaria.a@demo.sematec.test")').first; lr.locator('input[name=reason]').fill('Verificado con la persona')
    lr.locator('button:has-text("Desbloquear")').click(); status_msg(o)
    check(sql("select status from profiles where email = 'secretaria.a@demo.sematec.test'") == 'active', 'Desbloquea la cuenta')
    go(o, BASE + '/app/ciberseguridad?t=incidentes'); o.click('summary:has-text("Registrar incidente")')
    o.fill('input[name=title]', 'Intentos de acceso a tesorería'); o.select_option('select[name=severity]', 'alta')
    o.click('button:has-text("Registrar")'); m = status_msg(o); check('Incidente N°' in m, 'Registra un incidente')
    go(o, BASE + '/app/ciberseguridad?t=incidentes'); o.select_option('select[name=status]', 'cerrado'); o.fill('input[name=note]', 'Se confirmó que fue la propia usuaria; se cambió su contraseña')
    o.click('button:has-text("Agregar a la bitácora")'); status_msg(o)
    check(sql("select status || ':' || jsonb_array_length(log) from security_incidents limit 1") == 'cerrado:2', 'Bitácora y cierre del incidente')
    shot(o, 'ciber_incidentes')
    # Sin permiso: no entra
    e = login(b.new_context(), 'estudiante1.a@demo.sematec.test')
    r = e.request.get(BASE + '/app/ciberseguridad'); check(r.status == 404, 'Un estudiante no puede entrar al centro')
    p2 = login(b.new_context(), 'profesor1.a@demo.sematec.test')
    r = p2.request.get(BASE + '/app/ciberseguridad'); check(r.status == 404, 'Un profesor tampoco')
    b.close()
print(f"\n{sum(1 for ok, _ in results if ok)}/{len(results)} pruebas OK")
