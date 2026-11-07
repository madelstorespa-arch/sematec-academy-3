"""App instalable y uso sin conexión: páginas guardadas, bandeja de salida y envío automático al volver internet."""
import re, sys, os, time
sys.path.insert(0, os.path.dirname(__file__))
from e2e import BASE, CHROME, sql, check, shot, login, go, results
from playwright.sync_api import sync_playwright

ORG = '0a000000-0000-4000-8000-000000000001'
SEC = '0a000000-0000-4000-8000-00000000ad01'
sql(f"insert into section_enrollments (organization_id, section_id, student_id, enrollment_id) select '{ORG}', '{SEC}', e.student_id, e.id from enrollments e join students s on s.id = e.student_id where s.organization_id = '{ORG}' and s.user_id is not null on conflict do nothing")
ses = sql(f"insert into class_sessions (organization_id, section_id, starts_at, ends_at, topic) values ('{ORG}', '{SEC}', now() - interval '1 hour', now(), 'Clase sin internet') returning id").splitlines()[0]
st1 = sql("select id from students where user_id = '00000000-0000-4000-8000-000000000030'")

def wait_sw(p):
    p.wait_for_function('navigator.serviceWorker && navigator.serviceWorker.controller !== null', timeout=20000)

with sync_playwright() as pw:
    b = pw.chromium.launch(executable_path=CHROME, headless=True, args=['--no-sandbox'])
    # Manifiesto (app instalable)
    r = b.new_context().request.get(BASE + '/manifest.webmanifest'); m = r.json()
    check(m['display'] == 'standalone' and any(i['sizes'] == '512x512' for i in m['icons']), 'Manifiesto de app instalable con íconos')

    tc = b.new_context(viewport={'width': 390, 'height': 844}, is_mobile=True, service_workers='allow'); t = login(tc, 'profesor1.a@demo.sematec.test')
    go(t, BASE + '/app'); wait_sw(t)
    url = f'{BASE}/app/secciones/{SEC}?t=asistencia&clase={ses}'
    go(t, url); go(t, BASE + '/app')  # visitadas con internet -> quedan guardadas
    time.sleep(6)  # precarga de las páginas del menú
    n = t.evaluate("caches.open('sematec-pages').then(c => c.keys()).then(k => k.length)")
    check(n >= 3, f'Páginas guardadas en el dispositivo para uso sin conexión ({n})')

    # --- Sin internet ---
    tc.set_offline(True)
    t.goto(url); t.wait_for_selector('text=Sin conexión.', timeout=15000)
    check(t.locator('text=Clase sin internet').count() >= 1, 'Sin internet: la página de asistencia se abre desde el dispositivo')
    t.locator(f'input[name="att_{st1}"][value="absent"]').check()
    t.click('button:has-text("Guardar asistencia")')
    t.wait_for_selector('text=quedó guardado en este dispositivo', timeout=15000)
    check(t.locator('text=Aún NO está en la nube').count() == 1, 'Asistencia queda en la bandeja del dispositivo (avisa que aún no está en la nube)')
    t.wait_for_selector('text=cambio(s) esperando conexión', timeout=10000)
    check(sql(f"select count(*) from attendance_records where class_session_id = '{ses}'") == '0', 'Nada llegó a la base mientras no hay internet')
    shot(t, 'offline_asistencia_celular')
    t.goto(BASE + '/app/inventario-no-visitada'); t.wait_for_load_state('domcontentloaded')
    check(t.locator('text=Está sin conexión').count() == 1, 'Página nunca visitada: pantalla «sin conexión» con las guardadas')
    shot(t, 'offline_pantalla')
    t.click('#pages a:has-text("Inicio")'); t.wait_for_selector('text=Sin conexión.', timeout=15000)
    check(t.locator('text=cambio(s) esperando conexión').count() == 1, 'Desde la pantalla sin conexión se abre Inicio guardado y muestra lo pendiente')

    # --- Vuelve internet ---
    tc.set_offline(False)
    t.evaluate("window.dispatchEvent(new Event('online'))")
    try:
        t.wait_for_selector('text=ya se guardaron en la nube', timeout=30000)
    except Exception:
        shot(t, 'debug_sync'); print(t.locator('[data-testid=offline-bar]').inner_text()); raise
    check(sql(f"select status from attendance_records where class_session_id = '{ses}' and student_id = '{st1}'") == 'absent', 'Al volver internet la asistencia se envía sola y queda en la nube')
    shot(t, 'offline_sincronizado')

    # --- Estudiante: credencial sin internet ---
    ec = b.new_context(viewport={'width': 390, 'height': 844}, is_mobile=True, service_workers='allow'); e = login(ec, 'estudiante1.a@demo.sematec.test')
    go(e, BASE + '/app'); wait_sw(e)
    sql(f"insert into student_credentials (student_id, organization_id) values ('{st1}', '{ORG}') on conflict do nothing")
    go(e, BASE + '/app/credencial')
    code = sql(f"select code from student_credentials where student_id = '{st1}'")
    ec.set_offline(True); e.goto(BASE + '/app/credencial'); e.wait_for_selector('text=Sin conexión.', timeout=15000)
    check(e.locator(f'text={code}').count() >= 1 and e.locator('img[alt="Código QR de verificación"]').count() == 1, 'Credencial con QR visible sin internet')
    shot(e, 'offline_credencial_celular')
    ec.set_offline(False)

    # --- Cerrar sesión borra las copias del dispositivo ---
    go(e, BASE + '/app'); e.locator('button:has-text("Menú")').click() if e.locator('button:has-text("Menú")').count() else None
    e.click('button:has-text("Cerrar sesión")'); e.wait_for_url(re.compile('/login'))
    time.sleep(1)
    left = e.evaluate("caches.open('sematec-pages').then(c => c.keys()).then(k => k.length)")
    check(left == 0, 'Al cerrar sesión se borran las páginas guardadas (equipos compartidos)')
    b.close()
print(f"\n{sum(1 for ok, _ in results if ok)}/{len(results)} pruebas OK")
