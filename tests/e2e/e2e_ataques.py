"""Pruebas de ataque: la plataforma debe resistir intentos reales de romperla.
Cabeceras, XSS, redirección abierta, acceso a datos ajenos (IDOR), otra institución, escalada de privilegios
directo contra la API, inyección, fuerza bruta, archivos disfrazados, último propietario y certificados alterados."""
import re, sys, os, json, base64, urllib.parse
sys.path.insert(0, os.path.dirname(__file__))
from e2e import BASE, CHROME, PASS, sql, check, shot, login, status_msg, go, results
from playwright.sync_api import sync_playwright

ENV = dict(l.strip().split('=', 1) for l in open(os.path.join(os.path.dirname(__file__), '../../.env.local')) if '=' in l and not l.startswith('#'))
SB, ANON = ENV['NEXT_PUBLIC_SUPABASE_URL'], ENV['NEXT_PUBLIC_SUPABASE_ANON_KEY']
ORG = '0a000000-0000-4000-8000-000000000001'

def token(ctx):
    """Token de sesión del navegador (lo mismo que tendría un atacante con su propia cuenta)."""
    parts = sorted([c for c in ctx.cookies() if c['name'].startswith('sb-') and '-auth-token' in c['name']], key=lambda c: c['name'])
    raw = ''.join(urllib.parse.unquote(c['value']) for c in parts)
    if raw.startswith('base64-'): raw = base64.b64decode(raw[7:] + '===').decode()
    return json.loads(raw)['access_token']

def api(ctx, method, path, body=None):
    h = {'apikey': ANON, 'Authorization': f'Bearer {token(ctx)}', 'Content-Type': 'application/json', 'Prefer': 'return=representation'}
    return ctx.request.fetch(f'{SB}/rest/v1/{path}', method=method, headers=h, data=json.dumps(body) if body is not None else None)

st1 = sql("select id from students where user_id = '00000000-0000-4000-8000-000000000030'")
st2 = sql("select id from students where user_id = '00000000-0000-4000-8000-000000000031'")
stB = sql("select id from students where organization_id <> '" + ORG + "' limit 1")

with sync_playwright() as pw:
    b = pw.chromium.launch(executable_path=CHROME, headless=True, args=['--no-sandbox'])

    # 1. Cabeceras de seguridad
    r = b.new_context().request.get(BASE + '/login'); h = r.headers
    csp = h.get('content-security-policy', '')
    check("frame-ancestors 'none'" in csp and "'unsafe-eval'" not in csp and "object-src 'none'" in csp, 'CSP activa: sin eval, sin incrustar la página, sin plugins')
    check(h.get('x-frame-options') == 'DENY' and h.get('x-content-type-options') == 'nosniff' and 'max-age' in h.get('strict-transport-security', ''), 'Anti-clickjacking, nosniff y HSTS')
    check('x-powered-by' not in h, 'No revela la tecnología del servidor')

    # 2. XSS almacenado: un anuncio con código malicioso
    sc = b.new_context(); s = login(sc, 'secretaria.a@demo.sematec.test')
    go(s, BASE + '/app/anuncios'); s.click('summary:has-text("Publicar anuncio")')
    s.fill('input[name=title]', 'Aviso <img src=x onerror="window.__pwned=1">')
    s.fill('textarea[name=body]', '<script>window.__pwned=1</script>Hola <b onmouseover="window.__pwned=1">a todos</b>')
    s.click('button:has-text("Publicar")'); status_msg(s)
    ec = b.new_context(); e = login(ec, 'estudiante1.a@demo.sematec.test')
    go(e, BASE + '/app/anuncios'); e.wait_for_timeout(800)
    check(e.evaluate('window.__pwned') is None and e.locator('text=<script>window.__pwned=1</script>').count() >= 1, 'XSS: el código se muestra como texto y no se ejecuta')

    # 3. Redirección abierta tras iniciar sesión
    oc = b.new_context(); p = oc.new_page()
    for bad in ['/\\evil.example', '//evil.example', 'https://evil.example']:
        go(p, f'{BASE}/login?next={urllib.parse.quote(bad)}'); p.fill('input[name=email]', 'estudiante2.a@demo.sematec.test'); p.fill('input[name=password]', PASS)
        p.click('button[type=submit]'); p.wait_for_url(re.compile(r'localhost:3000/app'), timeout=20000)
        oc.clear_cookies()
    check('evil' not in p.url, 'Redirección abierta bloqueada (siempre vuelve a la plataforma)')

    # 4. IDOR: un estudiante intenta ver datos de otro
    for path in [f'/app/estudiantes/{st2}', f'/app/credencial?estudiante={st2}']:
        r = e.request.get(BASE + path); body = r.text()
        check(r.status == 404 or 'Dos' not in body, f'Estudiante no ve la ficha de otro ({path.split("?")[0]})')
    r = api(ec, 'GET', 'students?select=id'); ids = [x['id'] for x in r.json()]
    check(ids == [st1], f'API directa: el estudiante solo ve su propio registro ({len(ids)})')
    r = api(ec, 'GET', 'grades?select=student_id'); check(all(x['student_id'] == st1 for x in r.json()), 'API directa: solo sus propias notas')

    # 5. Escalada de privilegios directo contra la API
    r = api(ec, 'PATCH', 'profiles?id=eq.00000000-0000-4000-8000-000000000030', {'is_platform_admin': True})
    check(sql("select is_platform_admin from profiles where id = '00000000-0000-4000-8000-000000000030'") == 'f', 'No puede hacerse superadministrador')
    r = api(ec, 'POST', 'rpc/grant_membership', {'p_user': '00000000-0000-4000-8000-000000000030', 'p_org': ORG, 'p_role_code': 'propietario_institucional', 'p_campus': None, 'p_valid_until': None})
    check(r.status >= 400 and sql("select count(*) from memberships m join roles r on r.id = m.role_id where m.user_id = '00000000-0000-4000-8000-000000000030' and r.code = 'propietario_institucional'") == '0', 'No puede darse el rol de propietario')
    r = api(ec, 'POST', 'memberships', {'user_id': '00000000-0000-4000-8000-000000000030', 'organization_id': ORG, 'role_id': sql("select id from roles where code = 'secretaria' and organization_id is null")})
    check(r.status >= 400, 'No puede insertarse membresías por la API')
    r = api(ec, 'PATCH', f'grades?student_id=eq.{st1}', {'grade': 7})
    check(r.status >= 400 or r.json() == [], 'No puede cambiarse sus notas')
    r = api(ec, 'PATCH', f'installments?select=id', {'amount': 1})
    check(r.status >= 400 or r.json() == [], 'No puede rebajarse las cuotas')
    r = api(ec, 'DELETE', 'audit_events?id=gt.0')
    check(r.status >= 400 or r.json() == [], 'No puede borrar la auditoría')

    # 6. Otra institución
    owc = b.new_context(); ow = login(owc, 'propietario.a@demo.sematec.test', mfa=True)
    r = ow.request.get(f'{BASE}/app/estudiantes/{stB}'); check(r.status == 404, 'El propietario de A no ve estudiantes de la institución B')
    r = api(owc, 'GET', f'students?id=eq.{stB}&select=id'); check(r.json() == [], 'API: aislamiento total entre instituciones')

    # 7. Inyección en búsquedas
    for q in ["') or 1=1--", "%' or '1'='1", "a,first_names.ilike.*", "<script>"]:
        r = ow.request.get(f'{BASE}/app/estudiantes?q={urllib.parse.quote(q)}')
        check(r.status == 200 and 'Uno, Estudiante' not in r.text(), f'Inyección en búsqueda sin efecto ({q})')

    # 8. Archivo disfrazado
    exe = '/tmp/malicioso.pdf'; open(exe, 'wb').write(b'MZ\x90\x00' + b'\x00' * 200)
    go(ow, BASE + '/app/biblioteca'); ow.click('summary:has-text("Agregar libro")')
    ow.fill('input[name=title]', 'Libro falso'); ow.locator('form:has(input[name=title]) select[name=course_id]').select_option(index=1)
    ow.set_input_files('input[name=file]', exe); ow.click('button:has-text("Agregar")')
    check('no permitido' in status_msg(ow), 'Un ejecutable renombrado a .pdf es rechazado')

    # 9. Último propietario
    mid = sql("select m.id from memberships m join roles r on r.id = m.role_id where r.code = 'propietario_institucional' and m.organization_id = '" + ORG + "'")
    r = api(owc, 'POST', 'rpc/revoke_membership', {'p_membership': mid, 'p_reason': 'prueba'})
    check(r.status >= 400 and 'último propietario' in r.text(), 'No se puede quitar al último propietario')
    # Fuerza bruta contra el propietario: no lo deja sin acceso (tiene MFA)
    a = b.new_context().new_page()
    for _ in range(6):
        go(a, BASE + '/login'); a.fill('input[name=email]', 'propietario.a@demo.sematec.test'); a.fill('input[name=password]', 'Malisima12345'); a.click('button[type=submit]'); a.wait_for_timeout(400)
    check(sql("select status from profiles where email = 'propietario.a@demo.sematec.test'") == 'active'
          and sql("select count(*) from system_events where event_type = 'owner_bruteforce'") != '0', 'Ataque al propietario: no lo bloquea y genera alerta crítica')

    # 10. Fuerza bruta desde una misma red contra muchas cuentas
    atk = b.new_context(extra_http_headers={'x-real-ip': '203.0.113.77'}); a = atk.new_page()
    for i in range(20):
        go(a, BASE + '/login'); a.fill('input[name=email]', f'victima{i}@demo.sematec.test'); a.fill('input[name=password]', 'Adivinanza1234'); a.click('button[type=submit]'); a.wait_for_timeout(250)
    go(a, BASE + '/login'); a.fill('input[name=email]', 'estudiante2.a@demo.sematec.test'); a.fill('input[name=password]', PASS); a.click('button[type=submit]')
    a.wait_for_selector('text=Demasiados intentos fallidos desde esta red', timeout=15000)
    check(True, 'Fuerza bruta desde una red: se bloquea esa red por 15 minutos')
    shot(a, 'ataque_fuerza_bruta')

    # 11. Certificado alterado en la base
    cid = sql(f"insert into certificates (template_id, organization_id, serial_number, verification_code, student_id, recipient_name, title, payload, content_hash) values ((select id from certificate_templates where organization_id = '{ORG}' limit 1), '{ORG}', 9999, 'TEST-TAMP-0001-ZZZZ', '{st1}', 'Estudiante Uno', 'Diploma', '{{\"x\":1}}', encode(extensions.digest('TEST-TAMP-0001-ZZZZ|' || '{{\"x\": 1}}', 'sha256'), 'hex')) returning id").splitlines()[0]
    sql(f"set session_replication_role = replica; update certificates set payload = '{{\"x\":2}}' where id = '{cid}'")
    v = b.new_context().new_page(); go(v, f'{BASE}/verificar/TEST-TAMP-0001-ZZZZ')
    check(v.locator('text=/alterad|no es válido|NO válido|integridad/i').count() >= 1, 'Certificado alterado en la base: la verificación pública lo detecta')
    b.close()
print(f"\n{sum(1 for ok, _ in results if ok)}/{len(results)} pruebas OK")
