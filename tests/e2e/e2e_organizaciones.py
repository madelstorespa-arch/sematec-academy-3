"""🌎 Plataformas para otras organizaciones dentro del aula: solicitud pública, aprobación, espacio aislado, solo aula, exportación e independientes."""
import re, sys, os, json, subprocess
sys.path.insert(0, os.path.dirname(__file__))
from e2e import BASE, CHROME, sql, check, login, status_msg, go, results
from playwright.sync_api import sync_playwright
import pyotp

SEMATEC = '0a000000-0000-4000-8000-000000000001'
OWNER_A = sql("select id from profiles where email = 'propietario.a@demo.sematec.test'")
STUDENT = '00000000-0000-4000-8000-000000000030'
NEW_EMAIL = 'directora@asociacion-prueba.test'

def asu(uid, q):
    return subprocess.run(['bash', '/tmp/asu.sh', uid, q], capture_output=True, text=True)

sql("delete from org_signup_requests")

with sync_playwright() as pw:
    b = pw.chromium.launch(executable_path=CHROME, headless=True, args=['--no-sandbox'])
    new = lambda w=1366: b.new_context(viewport={'width': w, 'height': 900})

    # ---------- 1. Solicitud pública ----------
    pc = new(390); p = pc.new_page()
    go(p, f'{BASE}/registro-organizacion')
    p.fill('input[name=org_name]', 'Asociación Prueba de Chile')
    p.select_option('select[name=org_kind]', 'asociacion')
    p.select_option('select[name=wants]', 'aula')
    p.fill('input[name=contact_name]', 'Marie Joseph')
    p.fill('input[name=contact_email]', NEW_EMAIL)
    p.fill('input[name=members_estimate]', '80')
    p.fill('textarea[name=message]', 'Queremos dar clases en línea a nuestros socios.')
    p.click('button:has-text("Enviar solicitud")'); m = status_msg(p)
    check('Solicitud recibida' in m, f'📨 Una organización pide su aula desde el formulario público (celular) ({m[:50]})')
    check(sql(f"select wants || '|' || org_kind || '|' || status from org_signup_requests where contact_email = '{NEW_EMAIL}'") == 'aula|asociacion|pendiente', '🗄 La solicitud queda pendiente con lo que pidió')
    check(subprocess.run(['psql', '-h', '/tmp/pg', '-p', '54322', '-U', 'postgres', '-d', 'academy', '-tA', '-c', 'set role anon', '-c', 'select count(*) from org_signup_requests'], capture_output=True, text=True).returncode != 0,
          '🔒 Nadie de afuera puede leer las solicitudes')
    sql("insert into org_signup_requests (org_name, contact_name, contact_email) select 'Spam ' || g, 'Bot', 'bot@spam.test' from generate_series(1,3) g")
    go(p, f'{BASE}/registro-organizacion')
    p.fill('input[name=org_name]', 'Spam 4'); p.fill('input[name=contact_name]', 'Bot'); p.fill('input[name=contact_email]', 'bot@spam.test')
    p.click('button:has-text("Enviar solicitud")'); m = status_msg(p)
    check('varias solicitudes' in m, '🛡 Límite anti-abuso: no se pueden enviar solicitudes sin fin')
    sql("delete from org_signup_requests where contact_email = 'bot@spam.test'")
    pc.close()

    # ---------- 2. El dueño de la plataforma aprueba ----------
    ac = new(); a = login(ac, 'superadmin@demo.sematec.test', mfa=True)
    go(a, f'{BASE}/app')
    check(a.locator('[data-testid=plataformas-aula]').count() == 1, '🌎 El dueño de la plataforma ve «Plataformas para otras organizaciones»')
    check('📨 1' in a.locator('aside nav').first.inner_text(), '🔔 El menú avisa que hay 1 solicitud pendiente')
    go(a, f'{BASE}/app/instituciones?tab=solicitudes')
    li = a.locator('[data-solicitud="Asociación Prueba de Chile"]')
    check('Marie Joseph' in li.inner_text() and '80 personas' in li.inner_text(), '📋 Ve la solicitud con contacto y tamaño')
    check(li.locator('input[name=slug]').input_value() == 'asociacion-prueba-de-chile', '🔗 Propone un enlace a partir del nombre')
    li.locator('input[name=slug]').fill('asociacion-prueba')
    li.locator('button:has-text("Aprobar y crear")').click()
    a.wait_for_selector('[data-testid=resultado-solicitud]', timeout=30000)
    m = a.locator('[data-testid=resultado-solicitud]').inner_text()
    pw_match = re.search(r'solo esta vez\): (\S+)', m)
    check('/o/asociacion-prueba' in m and pw_match, f'✅ Aprobada: se crea la organización y la cuenta de su propietaria ({m[:60]})')
    temp = pw_match.group(1)
    NEW_ORG = sql("select id from organizations where slug = 'asociacion-prueba'")
    check(sql(f"select platform_mode || '|' || org_kind || '|' || base_currency from organizations where id = '{NEW_ORG}'") == 'aula|asociacion|CLP', '🎥 Tipo «solo aula virtual», tipo asociación y moneda del país')
    check(sql(f"select status from org_signup_requests where contact_email = '{NEW_EMAIL}'") == 'aprobada', '📨 La solicitud queda aprobada')
    check(sql(f"select site_name from site_settings where organization_id = '{NEW_ORG}'") == 'Asociación Prueba de Chile', '🎨 Tiene su propia marca desde el primer día')

    go(a, f'{BASE}/app/instituciones')
    row = a.locator('tr[data-org="asociacion-prueba"]')
    check('Aula' in row.inner_text() and 'Marie Joseph' in row.inner_text(), '🌎 Aparece en la lista con su tipo y su propietaria')

    # Crear otra directamente (sistema completo)
    f = a.locator('#nueva-org')
    f.locator('input[name=display_name]').fill('Instituto Técnico Norte')
    f.locator('select[name=platform_mode]').select_option('completo')
    f.locator('select[name=org_kind]').select_option('instituto')
    f.locator('input[name=owner_name]').fill('Pedro Norte'); f.locator('input[name=owner_email]').fill('pedro@itnorte.test')
    f.locator('button:has-text("Crear organización")').click(); m = status_msg(a)
    check('/o/instituto-tecnico-norte' in m, f'➕ El dueño también crea organizaciones directamente ({m[:50]})')
    check(sql("select platform_mode from organizations where slug = 'instituto-tecnico-norte'") == 'completo', '🏛 Con sistema completo si lo elige')
    f.locator('input[name=display_name]').fill('Otro'); f.locator('input[name=slug]').fill('asociacion-prueba')
    f.locator('input[name=owner_name]').fill('X'); f.locator('input[name=owner_email]').fill('x@x.test')
    f.locator('button:has-text("Crear organización")').click(); m = status_msg(a)
    check('ya está en uso' in m, '⛔ No se puede repetir un enlace')

    # ---------- 3. Enlace propio e ingreso de la organización ----------
    oc = new(390); o = oc.new_page()
    go(o, f'{BASE}/o/asociacion-prueba')
    check('Asociación Prueba de Chile' in o.locator('[data-testid=org-landing]').inner_text(), '🔗 Su enlace propio /o/asociacion-prueba muestra su nombre y marca')
    o.click('[data-testid=org-ingresar]')
    o.wait_for_url(re.compile(r'/login'))
    o.fill('input[name=email]', NEW_EMAIL); o.fill('input[name=password]', temp); o.click('button[type=submit]')
    o.wait_for_url(re.compile(r'/mfa'), timeout=20000)
    o.wait_for_selector('code', timeout=20000)
    secret = o.locator('code').inner_text().strip()
    o.fill('input[inputmode=numeric]', pyotp.TOTP(secret).now()); o.click('button:has-text("Verificar")')
    o.wait_for_url(re.compile(r'/app'), timeout=20000)
    go(o, f'{BASE}/app/conferencias')
    check('Asociación Prueba de Chile' in o.locator('main').inner_text(), '🎥 La propietaria entra a SU aula virtual (con la verificación en dos pasos)')
    menu = o.locator('aside nav').first.text_content()
    check('Aulas virtuales' in menu and 'SEMATEC VENTA' not in menu and 'Finanzas' not in menu and 'Sucursales' not in menu,
          '🧩 Plataforma solo aula: el menú no tiene ventas, finanzas ni sucursales')
    go(o, f'{BASE}/app/finanzas')
    check(o.locator('[data-testid=modulo-no-disponible]').count() == 1, '⛔ Aunque escriba la dirección, los módulos administrativos no se abren')

    # Crea su sala
    go(o, f'{BASE}/app/conferencias')
    ac2 = o.locator('form:has(button:has-text("Crear sala"))')
    ac2.locator('input[name=name]').fill('Sala Asamblea')
    ac2.locator('button:has-text("Crear sala")').click(); m = status_msg(o)
    check(sql(f"select count(*) from conference_rooms where organization_id = '{NEW_ORG}' and name = 'Sala Asamblea'") == '1', '🏫 Crea su propia sala de clases')

    # ---------- 4. Aislamiento ----------
    NEW_OWNER = sql(f"select id from profiles where email = '{NEW_EMAIL}'")
    check(asu(NEW_OWNER, f"select count(*) from students where organization_id = '{SEMATEC}'").stdout.strip().splitlines()[-1] == '0'
          and asu(NEW_OWNER, f"select count(*) from conference_rooms where organization_id = '{SEMATEC}'").stdout.strip().splitlines()[-1] == '0',
          '🔒 Aislada: no ve estudiantes ni salas de SEMATEC')
    check(asu(OWNER_A, f"select count(*) from conference_rooms where organization_id = '{NEW_ORG}'").stdout.strip().splitlines()[-1] == '0',
          '🔒 Y SEMATEC no ve las salas de la asociación')
    check(asu(STUDENT, 'select * from platform_overview()').returncode != 0 and asu(NEW_OWNER, f"select set_organization_platform('{NEW_ORG}', 'completo')").returncode != 0,
          '🔒 Solo el dueño de la plataforma ve el resumen y cambia el tipo')

    # ---------- 5. Exportar sus datos ----------
    go(o, f'{BASE}/app/configuracion?t=institucion')
    check('/o/asociacion-prueba' in o.locator('[data-testid=enlace-propio]').inner_text(), '🔗 La propietaria ve su enlace para compartir')
    r = o.request.get(f'{BASE}/app/configuracion/exportar')
    data = json.loads(r.text())
    rooms = data['tablas'].get('conference_rooms', [])
    check(r.ok and data['organizacion']['slug'] == 'asociacion-prueba' and len(rooms) == 1 and rooms[0]['name'] == 'Sala Asamblea'
          and all(x.get('organization_id') == NEW_ORG for t in data['tablas'].values() for x in t),
          f'📦 Descarga todos sus datos (JSON) y solo los suyos ({len(data["tablas"])} tablas)')

    # ---------- 6. Suspender y reactivar ----------
    go(a, f'{BASE}/app/instituciones')
    a.once('dialog', lambda d: d.accept())
    a.locator('tr[data-org="asociacion-prueba"] button:has-text("Suspender")').click()
    a.wait_for_function("() => document.querySelector('tr[data-org=\"asociacion-prueba\"]')?.innerText.includes('Reactivar')", timeout=20000)
    check(asu(NEW_OWNER, 'select count(*) from my_organizations()').stdout.strip().splitlines()[-1] == '0', '⏸ Suspendida: sus miembros ya no pueden entrar')
    a.locator('tr[data-org="asociacion-prueba"] button:has-text("Reactivar")').click()
    a.wait_for_function("() => document.querySelector('tr[data-org=\"asociacion-prueba\"]')?.innerText.includes('Suspender')", timeout=20000)
    check(asu(NEW_OWNER, 'select count(*) from my_organizations()').stdout.strip().splitlines()[-1] == '1', '▶ Reactivada: vuelven a entrar')

    # ---------- 7. Plataforma independiente (su propia base de datos) ----------
    go(a, f'{BASE}/app/instituciones?tab=independientes')
    a.fill('[data-testid=indep-nombre]', 'Colegio Esperanza')
    href = a.locator('[data-testid=indep-desplegar]').get_attribute('href')
    check('vercel.com/new/clone' in href and 'repository-url=' in href and 'project-name=colegio-esperanza' in href and 'SUPABASE_SERVICE_ROLE_KEY' in href,
          '🗄 Guía con botón que crea una copia del sistema en Vercel con su propia base de datos')
    nf = a.locator('#nueva-independiente')
    nf.locator('input[name=name]').fill('Colegio Esperanza'); nf.locator('input[name=url]').fill('http://colegio.test')
    nf.locator('button:has-text("Agregar")').click(); m = status_msg(a)
    check('https://' in m, '⛔ Solo acepta direcciones seguras (https)')
    nf.locator('input[name=url]').fill('https://colegio-esperanza.vercel.app')
    nf.locator('button:has-text("Agregar")').click(); m = status_msg(a)
    check('agregada' in m and 'colegio-esperanza.vercel.app' in a.locator('[data-testid=tabla-independientes]').inner_text(), '📒 Queda en el directorio de plataformas independientes')
    check(asu(OWNER_A, 'select count(*) from external_platforms').stdout.strip().splitlines()[-1] == '0', '🔒 Solo el dueño de la plataforma ve ese directorio')

    b.close()

ok = sum(1 for r in results if r[0]); print(f'\n{ok}/{len(results)} verificaciones OK')
