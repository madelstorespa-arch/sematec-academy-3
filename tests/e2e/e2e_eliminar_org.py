"""🗑 Eliminar una organización: suspendida primero, confirmación con su enlace, datos protegidos incluidos y solo el superadministrador."""
import re, sys, os, subprocess
sys.path.insert(0, os.path.dirname(__file__))
from e2e import BASE, CHROME, sql, check, login, status_msg, go, results
from playwright.sync_api import sync_playwright

CL = '0a000000-0000-4000-8000-000000000001'
PE = '0b000000-0000-4000-8000-000000000001'
SA = sql("select id from profiles where email = 'superadmin@demo.sematec.test'")
OWNER_A = sql("select id from profiles where email = 'propietario.a@demo.sematec.test'")
PE_USERS = sql(f"select string_agg(distinct user_id::text, ',') from memberships where organization_id = '{PE}'").split(',')

def asu(uid, q):
    return subprocess.run(['bash', '/tmp/asu.sh', uid, q], capture_output=True, text=True)

def as_admin_rollback(q):
    """Ejecuta como superadministrador dentro de una transacción que se deshace."""
    script = f"""begin; update organizations set status = 'inactive' where id = '{CL}';
set local role authenticated; set local request.jwt.claims = '{{"sub":"{SA}","role":"authenticated","aal":"aal2"}}';
{q}
reset role; select (select count(*) from organizations where id = '{CL}') || '|' || (select count(*) from payments where organization_id = '{CL}') || '|' || (select count(*) from students where organization_id = '{CL}');
rollback;"""
    return subprocess.run(['psql', '-h', '/tmp/pg', '-p', '54322', '-U', 'postgres', '-d', 'academy', '-tA', '-v', 'ON_ERROR_STOP=1', '-c', script], capture_output=True, text=True)

# ---------- Base de datos: también borra pagos, notas y certificados protegidos (prueba deshecha al final) ----------
pay_before = sql(f"select count(*) from payments where organization_id = '{CL}'")
r = as_admin_rollback(f"select (public.delete_organization('{CL}', 'sematec-demo-cl'))->>'rows';")
lines = [l for l in r.stdout.strip().splitlines() if l.count('|') == 2]
last = lines[-1] if lines else r.stdout[-200:] + r.stderr[-300:]
check(r.returncode == 0 and last == '0|0|0', f'🗄 Elimina por completo una organización con datos (pagos antes: {pay_before}; quedan: {last})')
check(sql(f"select count(*) from organizations where id = '{CL}'") == '1', '↩ (prueba deshecha: la organización principal sigue intacta)')
check(asu(OWNER_A, f"select delete_organization('{PE}', 'sematec-demo-pe')").returncode != 0, '🔒 Un propietario de otra organización no puede eliminar organizaciones')
check(asu(SA, f"select delete_organization('{PE}', 'sematec-demo-pe')").returncode != 0 and 'suspenda' in asu(SA, f"select delete_organization('{PE}', 'sematec-demo-pe')").stderr,
      '⏸ Una organización activa no se puede eliminar: primero se suspende')

with sync_playwright() as pw:
    b = pw.chromium.launch(executable_path=CHROME, headless=True, args=['--no-sandbox'])
    ac = b.new_context(viewport={'width': 1366, 'height': 900})
    a = login(ac, 'superadmin@demo.sematec.test', mfa=True)
    go(a, f'{BASE}/app/instituciones')
    row = a.locator('tr[data-org="sematec-demo-pe"]')
    check(row.locator('[data-testid=eliminar-org]').count() == 0, '🛡 Mientras está activa no aparece «Eliminar»')
    go(a, f'{BASE}/app/instituciones/eliminar/{PE}')
    check(a.locator('[data-testid=eliminar-bloqueado]').count() == 1 and a.locator('#eliminar-org').count() == 0, '🛡 Ni entrando directo por la dirección')

    go(a, f'{BASE}/app/instituciones')
    a.once('dialog', lambda d: d.accept())
    a.locator('tr[data-org="sematec-demo-pe"] button:has-text("Suspender")').click()
    a.wait_for_function("() => document.querySelector('tr[data-org=\"sematec-demo-pe\"]')?.innerText.includes('Eliminar')", timeout=20000)
    a.locator('tr[data-org="sematec-demo-pe"] [data-testid=eliminar-org]').click()
    a.wait_for_selector('[data-testid=resumen-eliminar]')
    txt = a.locator('[data-testid=resumen-eliminar]').inner_text()
    check('Personas' in txt and 'Grabaciones' in txt and 'Pagos' in txt, '📋 Antes de eliminar muestra todo lo que se borrará')
    f = a.locator('#eliminar-org')
    f.locator('input[name=confirm]').fill('sematec-demo-xx'); f.locator('input[name=entiendo]').check()
    f.locator('button:has-text("Eliminar definitivamente")').click(); m = status_msg(a)
    check('escriba exactamente' in m.lower(), f'⛔ Con un enlace mal escrito no elimina nada ({m[:60]})')
    check(sql(f"select count(*) from organizations where id = '{PE}'") == '1', '🗄 La organización sigue ahí')

    f.locator('input[name=confirm]').fill('sematec-demo-pe'); f.locator('input[name=borrar_cuentas]').check()
    f.locator('button:has-text("Eliminar definitivamente")').click()
    a.wait_for_selector('[data-testid=org-eliminada]', timeout=60000)
    banner = a.locator('[data-testid=org-eliminada]').inner_text()
    check('SEMATEC Perú' in banner and 'cuentas' in banner, f'✅ Eliminada, con resumen ({banner[:80]})')
    check(sql(f"select count(*) from organizations where id = '{PE}'") == '0' and sql(f"select count(*) from memberships where organization_id = '{PE}'") == '0',
          '🗄 Ya no existe ni tiene miembros')
    left = sql(f"select count(*) from profiles where id = any('{{{','.join(PE_USERS)}}}'::uuid[]) and status = 'active'")
    check(left == '0', '👤 Las cuentas que solo eran de esa organización se borraron (o quedaron desactivadas)')
    check(sql("select count(*) from audit_events where action = 'organization.delete'") == '1', '📜 La auditoría de la plataforma guarda constancia')
    check('sematec-demo-pe' not in a.locator('[data-testid=tabla-orgs]').inner_text(), '🌎 Ya no aparece en la lista')
    b.close()

ok = sum(1 for r in results if r[0]); print(f'\n{ok}/{len(results)} verificaciones OK')
