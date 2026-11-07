"""Asignar rol con cuenta nueva: mensajes claros (contraseña corta, invitación sin SMTP) y éxito con contraseña válida."""
import sys, os
sys.path.insert(0, os.path.dirname(__file__))
from e2e import BASE, CHROME, sql, check, shot, login, status_msg, go, results
from playwright.sync_api import sync_playwright

with sync_playwright() as pw:
    b = pw.chromium.launch(executable_path=CHROME, headless=True, args=['--no-sandbox'])
    c = b.new_context(viewport={'width': 390, 'height': 844}, is_mobile=True); o = login(c, 'propietario.a@demo.sematec.test', mfa=True)
    def fill(pwd, invite):
        go(o, BASE + '/app/usuarios')
        o.fill('input[name=email]', 'marc.secretaria@demo.sematec.test'); o.fill('input[name=full_name]', 'MARC ANDRE VERTISMA')
        o.select_option('select[name=role]', 'secretaria'); o.fill('form:has(input[name=full_name]) input[name=password]', pwd)
        if invite: o.check('input[name=invite]')
        o.click('button:has-text("Asignar rol")'); return status_msg(o)
    m = fill('Marc1998', True)
    check('al menos 10 caracteres (escribió 8)' in m, f'Contraseña corta: mensaje claro ({m[:70]})'); shot(o, 'usuarios_clave_corta')
    m = fill('', True)
    check('SMTP' in m or 'invitación' in m, f'Invitación sin SMTP: mensaje claro ({m[:70]})')
    m = fill('MarcAndre1998', True)
    check('Rol asignado' in m, f'Contraseña válida (aunque esté marcado invitar): cuenta creada ({m[:60]})')
    check(sql("select count(*) from memberships m join profiles p on p.id = m.user_id join roles r on r.id = m.role_id where p.email = 'marc.secretaria@demo.sematec.test' and r.code = 'secretaria'") == '1', 'Rol de secretaría asignado')
    b.close()
print(f"\n{sum(1 for ok, _ in results if ok)}/{len(results)} pruebas OK")
