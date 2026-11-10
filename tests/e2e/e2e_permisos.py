"""🛡 Autorizaciones por usuario sin tocar código: permitir algo extra o quitar un permiso del rol, por sede y con vencimiento."""
import re, sys, os, time, subprocess
sys.path.insert(0, os.path.dirname(__file__))
from e2e import BASE, CHROME, sql, check, login, status_msg, go, results
from playwright.sync_api import sync_playwright

ORG = '0a000000-0000-4000-8000-000000000001'
SEC = '00000000-0000-4000-8000-000000000011'   # secretaria (tienda: ver y vender)
OWNER = sql("select id from profiles where email = 'propietario.a@demo.sematec.test'")

def has(uid, perm, aal='aal2'):
    q = f"""set request.jwt.claims = '{{"sub":"{uid}","role":"authenticated","aal":"{aal}"}}'; select private.has_permission('{ORG}', '{perm}')"""
    return sql(q).splitlines()[-1] == 't'
def asu(uid, q):
    return subprocess.run(['bash', '/tmp/asu.sh', uid, q], capture_output=True, text=True)

sql(f"delete from user_permissions where user_id = '{SEC}'")
sql("update profiles set id_document_type = 'RUN', id_document_number = '17.654.321-3' where email = 'secretaria.a@demo.sematec.test' and id_document_number is null")

with sync_playwright() as pw:
    b = pw.chromium.launch(executable_path=CHROME, headless=True, args=['--no-sandbox'])
    new = lambda: b.new_context(viewport={'width': 1440, 'height': 900})
    check(not has(SEC, 'store.edit') and has(SEC, 'store.create'), 'Antes: la secretaria vende, pero no puede crear productos (su rol)')

    oc = new(); o = login(oc, 'propietario.a@demo.sematec.test', mfa=True)
    go(o, f'{BASE}/app/usuarios')
    o.locator('tr:has-text("secretaria.a@demo.sematec.test") [data-testid=permisos-usuario]').first.click()
    o.wait_for_selector('[data-testid=matriz-permisos]')
    check(o.locator('select[name="p:store.create"] option').first.inner_text().startswith('✓') and o.locator('select[name="p:store.edit"] option').first.inner_text().startswith('—'),
          '🛡 La pantalla muestra lo que da su rol (✓ Vender, — Productos)')
    o.select_option('select[name="p:store.edit"]', 'allow')
    o.select_option('select[name="p:students.view"]', 'allow')
    o.select_option('select[name="p:store.create"]', 'deny')
    o.fill('input[name=reason]', 'Reemplazo de la encargada de tienda')
    o.click('button:has-text("Guardar autorizaciones")'); m = status_msg(o)
    check('2 permiso(s) extra y 1 quitado(s)' in m, f'💾 El propietario guarda las autorizaciones sin tocar código ({m[:70]})')
    check(has(SEC, 'store.edit') and has(SEC, 'students.view') and not has(SEC, 'store.create'), '🔒 La base de datos aplica: ahora puede crear productos y ver estudiantes, y ya no puede vender')
    check(sql(f"select count(*) from audit_events where table_name = 'user_permissions' and new_data->>'user_id' = '{SEC}'") == '3', '📜 Cada autorización queda en la auditoría')

    sc = new(); s = login(sc, 'secretaria.a@demo.sematec.test')
    nav = s.locator('aside nav').first.inner_text()
    check('Estudiantes' in nav, '📋 Le aparece en el menú lo que se le autorizó (Estudiantes)')
    go(s, f'{BASE}/app/tienda/caja')
    check('/app/tienda/caja' not in s.url, '⛔ Lo que se le quitó desaparece: ya no entra a la caja')
    go(s, f'{BASE}/app/tienda/productos')
    check(s.locator('summary:has-text("Nuevo producto")').count() == 1, '✅ Y puede crear productos')
    sc.close()

    # Seguridad
    r = asu(SEC, f"""select set_user_permissions('{ORG}', '{SEC}', '[{{"code":"security.admin","effect":"allow"}}]'::jsonb)""")
    check(r.returncode != 0, '🔒 Nadie puede darse permisos a sí mismo')
    r = asu(SEC, f"""select set_user_permissions('{ORG}', '00000000-0000-4000-8000-000000000020', '[{{"code":"finance.admin","effect":"allow"}}]'::jsonb)""")
    check(r.returncode != 0, '🔒 Quien no administra la seguridad no puede dar permisos')
    r = asu(OWNER, f"""select set_user_permissions('{ORG}', '{OWNER}', '[]'::jsonb)""")
    check(r.returncode != 0, '🔒 Los permisos del propietario no se pueden cambiar')
    sql(f"insert into user_permissions (organization_id, user_id, permission_code, effect) values ('{ORG}', '{SEC}', 'users.admin', 'allow')")
    check(not has(SEC, 'users.admin', 'aal1') and has(SEC, 'users.admin', 'aal2'), '🔐 Un permiso delicado dado a una persona exige su verificación en dos pasos')
    sql(f"delete from user_permissions where user_id = '{SEC}' and permission_code = 'users.admin'")
    sql(f"update user_permissions set valid_until = now() - interval '1 minute' where user_id = '{SEC}'")
    check(not has(SEC, 'store.edit') and has(SEC, 'store.create'), '⏰ Al vencer la fecha, vuelve solo a los permisos de su rol')

    # Volver a dejarla solo con su rol desde la pantalla
    go(o, f'{BASE}/app/usuarios/{SEC}/permisos')
    for code in ['store.edit', 'students.view', 'store.create']: o.select_option(f'select[name="p:{code}"]', '')
    o.click('button:has-text("Guardar autorizaciones")'); m = status_msg(o)
    check('solo con los permisos de su rol' in m and sql(f"select count(*) from user_permissions where user_id = '{SEC}'") == '0', '↩ Se quitan todas y queda solo con su rol')
    go(o, f'{BASE}/app/usuarios/{OWNER}/permisos')
    check('no se pueden cambiar' in o.locator('main').inner_text(), '🔒 La pantalla del propietario lo explica y no deja cambiar')
    oc.close()

ok = sum(1 for r in results if r[0]); print(f'\n{ok}/{len(results)} verificaciones OK')
