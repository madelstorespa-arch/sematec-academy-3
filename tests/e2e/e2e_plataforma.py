"""Plataforma: ventanas (maximizar, minimizar, cerrar), accesibilidad, deshacer/rehacer para todos (incluye ventas),
libros ocultos a quien se elija, y el propietario edita/elimina usuarios por rol (también en lote)."""
import re, sys, os, time
sys.path.insert(0, os.path.dirname(__file__))
from e2e import BASE, CHROME, sql, check, login, results
from playwright.sync_api import sync_playwright

ORG = '0a000000-0000-4000-8000-000000000001'
PW = 'Sematec-Demo-2026'
def go(page, url): page.goto(url); page.wait_for_load_state('load')
def form_status(form):
    loc = form.locator('[role=status]'); loc.wait_for(timeout=20000); return loc.inner_text()
def wait_sql(q, expected, timeout=20):
    end = time.time() + timeout
    while time.time() < end:
        v = sql(q)
        if v == expected: return True
        time.sleep(0.5)
    return False

sql("delete from system_events where event_type like 'rate:%'"); sql("delete from expenses where description = 'Gasto para deshacer E2E'")
sql("update profiles set full_name = 'Cajera Demo', id_document_type = 'RUN', id_document_number = '11.111.111-1' where email = 'secretaria.a@demo.sematec.test'")
for e in ['temporal1.e2e@demo.sematec.test', 'temporal2.e2e@demo.sematec.test', 'temporal3.e2e@demo.sematec.test']:
    sql(f"delete from memberships where user_id in (select id from profiles where email = '{e}')")
    sql(f"update profiles set status = 'active', status_reason = null where email = '{e}'"); sql(f"update auth.users set banned_until = null where email = '{e}'")

with sync_playwright() as pw:
    b = pw.chromium.launch(executable_path=CHROME, headless=True, args=['--no-sandbox'])
    mc = b.new_context(viewport={'width': 1400, 'height': 900}); m = login(mc, 'matriculas.a@demo.sematec.test'); m.on('dialog', lambda d: d.accept())

    # ================= 1. Ventanas =================
    go(m, f'{BASE}/app/matriculas')
    bar = m.locator('[data-testid=barra-ventana]')
    check(bar.is_visible() and m.locator('[data-testid=ventana-minimizar]').count() == 1 and m.locator('[data-testid=ventana-maximizar]').count() == 1
          and m.locator('[data-testid=ventana-cerrar]').count() == 1, '🪟 Cada página tiene botones minimizar, maximizar y cerrar')
    m.click('[data-testid=ventana-maximizar]')
    check(m.evaluate("document.documentElement.dataset.max") == '1' and not m.locator('aside.app-aside').is_visible(), '🗖 Maximizar: oculta el menú y usa toda la pantalla')
    go(m, f'{BASE}/app/matriculas')
    check(not m.locator('aside.app-aside').is_visible(), '🗖 La pantalla amplia se mantiene al cambiar de página')
    m.click('[data-testid=ventana-maximizar]')
    check(m.locator('aside.app-aside').is_visible(), '🗗 Restaurar: vuelve el menú')
    m.click('[data-testid=ventana-minimizar]'); m.wait_for_url(f'{BASE}/app', timeout=15000)
    task = m.locator('[data-testid=barra-tareas]')
    check(task.is_visible() and 'Matrículas' in task.inner_text(), '🗕 Minimizar: la página queda en la barra de tareas de abajo')
    task.locator('button:has-text("Matrículas")').click(); m.wait_for_url(re.compile('/app/matriculas'), timeout=15000)
    check(m.locator('[data-testid=barra-tareas]').count() == 0, '🗕 Al tocarla se restaura la página')
    m.locator('nav a:has-text("Finanzas")').first.click(); m.wait_for_url(re.compile('/app/finanzas'), timeout=15000)
    m.click('[data-testid=ventana-cerrar]'); m.wait_for_url(re.compile('/app/matriculas'), timeout=15000)
    check('/app/matriculas' in m.url, '✕ Cerrar: vuelve a la página anterior')

    # ================= 2. Accesibilidad =================
    m.click('[data-testid=accesibilidad]'); p = m.locator('[data-testid=panel-accesibilidad]')
    p.locator('button[aria-pressed]').nth(3).click()
    check(m.evaluate("getComputedStyle(document.documentElement).fontSize") == '21px', '🔠 Letra más grande (todo el sistema)')
    p.locator('[data-testid=a11y-theme]').check()
    check(m.evaluate("document.documentElement.dataset.theme") == 'dark', '🌙 Modo oscuro')
    p.locator('[data-testid=a11y-contrast]').check(); p.locator('[data-testid=a11y-links]').check()
    go(m, f'{BASE}/app/finanzas')
    for _ in range(20):
        if m.evaluate("document.documentElement.dataset.theme + document.documentElement.dataset.fs + document.documentElement.dataset.contrast") == 'darkxl1': break
        time.sleep(0.25)
    check(m.evaluate("document.documentElement.dataset.theme + document.documentElement.dataset.fs + document.documentElement.dataset.contrast") == 'darkxl1',
          '♿ Las preferencias de accesibilidad se recuerdan al cambiar de página')
    m.click('[data-testid=accesibilidad]'); m.locator('[data-testid=panel-accesibilidad] button:has-text("Restablecer")').click()
    check(m.evaluate("document.documentElement.dataset.theme") == 'light', '♿ Restablecer accesibilidad')

    # ================= 3. Deshacer / rehacer para todos =================
    go(m, f'{BASE}/app/finanzas/gastos')
    x = m.locator('form:has(input[name=supplier])').first
    x.locator('input[name=amount]').fill('1234'); x.locator('input[name=description]').fill('Gasto para deshacer E2E'); x.locator('button:has-text("Guardar gasto")').click(); form_status(x)
    m.wait_for_selector('[data-testid=barra-deshacer] button[aria-label=Deshacer]:not([disabled])', timeout=15000)
    m.click('[data-testid=barra-deshacer] button[aria-label=Deshacer]')
    check(wait_sql("select count(*) from expenses where description = 'Gasto para deshacer E2E'", '0'), '↶ Deshacer funciona para el personal (no solo el propietario)')
    m.wait_for_selector('[data-testid=barra-deshacer] button[aria-label=Rehacer]:not([disabled])', timeout=15000)
    m.click('[data-testid=barra-deshacer] button[aria-label=Rehacer]')
    check(wait_sql("select count(*) from expenses where description = 'Gasto para deshacer E2E'", '1'), '↷ Rehacer vuelve a aplicar el cambio')
    m.wait_for_selector('[data-testid=barra-deshacer] button[aria-label=Deshacer]:not([disabled])', timeout=15000); time.sleep(1)
    m.locator('h1').first.click(); m.keyboard.press('Control+z')
    check(wait_sql("select count(*) from expenses where description = 'Gasto para deshacer E2E'", '0'), '⌨ Ctrl+Z también deshace')

    prod = sql(f"select id from products where organization_id = '{ORG}' and active and track_stock and stock > 2 order by name limit 1")
    if prod:
        sc = b.new_context(viewport={'width': 1366, 'height': 900}); s = login(sc, 'secretaria.a@demo.sematec.test')
        before = sql(f"select stock from products where id = '{prod}'"); sku = sql(f"select sku from products where id = '{prod}'")
        go(s, f'{BASE}/app/tienda/caja'); s.fill('[data-testid=caja-buscar]', sku); s.keyboard.press('Enter')
        s.locator('button:has-text("Tarjeta")').click(); s.click('[data-testid=cobrar]'); s.wait_for_selector('[data-testid=venta-lista]')
        sale = sql(f"select id from sales where organization_id = '{ORG}' order by created_at desc limit 1")
        s.click('[data-testid=nueva-venta]')
        s.wait_for_selector('[data-testid=barra-deshacer] button[aria-label=Deshacer]:not([disabled])', timeout=15000)
        s.click('[data-testid=barra-deshacer] button[aria-label=Deshacer]')
        check(wait_sql(f"select count(*) from sales where id = '{sale}'", '0') and sql(f"select stock from products where id = '{prod}'") == before,
              '↶ La cajera deshace una venta: la venta desaparece y el stock vuelve completo')

    # ================= 4. Libros ocultos =================
    oc = b.new_context(viewport={'width': 1400, 'height': 900}); o = login(oc, 'propietario.a@demo.sematec.test', mfa=True); o.on('dialog', lambda d: d.accept())
    prog = sql(f"select id from programs where organization_id = '{ORG}' order by created_at limit 1")
    sql(f"delete from library_items where organization_id = '{ORG}' and title like '%E2E privado%'")
    go(o, f'{BASE}/app/biblioteca')
    o.locator('summary:has-text("Agregar libro")').click()
    f = o.locator('form:has(input[name=title])').first
    f.locator('input[name=title]').fill('Manual docente E2E privado'); f.locator('select[name=program_id]').select_option(prog)
    f.locator('input[name=url]').fill('https://example.com/manual.pdf')
    f.locator('input[name=vis_mode][value=roles]').check(); f.locator('input[name=visible_roles][value=profesor]').check()
    f.locator('button:has-text("Agregar")').click(); form_status(f)
    check(sql("select array_to_string(visible_roles, ',') from library_items where title = 'Manual docente E2E privado'") == 'profesor', '📚 Libro visible solo para profesores')
    ec = b.new_context(); ep = login(ec, 'estudiante1.a@demo.sematec.test'); go(ep, f'{BASE}/app/biblioteca')
    tc = b.new_context(); tp = login(tc, 'profesor1.a@demo.sematec.test'); go(tp, f'{BASE}/app/biblioteca')
    se, sp_ = 'Manual docente E2E privado' in ep.locator('main').inner_text(), 'Manual docente E2E privado' in tp.locator('main').inner_text()
    check(not se and sp_, f'🔒 El estudiante no lo ve; el profesor sí (estudiante={se}, profesor={sp_})')
    est1 = sql("select id from auth.users where email = 'estudiante1.a@demo.sematec.test'")
    item = sql("select id from library_items where title = 'Manual docente E2E privado'")
    go(o, f'{BASE}/app/biblioteca')
    row = o.locator('tr:has-text("Manual docente E2E privado")')
    row.locator('summary:has-text("Quién lo ve")').click()
    vf = row.locator('form'); vf.locator('input[name=vis_mode][value=todos]').check()
    vf.locator('summary:has-text("Ocultar a personas")').click(); vf.locator('input[placeholder="Buscar persona…"]').fill('Estudiante Uno')
    vf.locator(f'input[name=hidden_users][value="{est1}"]').check(); vf.locator('button:has-text("Guardar")').click(); form_status(vf)
    est2 = b.new_context(); e2 = login(est2, 'estudiante2.a@demo.sematec.test'); go(e2, f'{BASE}/app/biblioteca'); go(ep, f'{BASE}/app/biblioteca')
    check('Manual docente E2E privado' in e2.locator('main').inner_text() and 'Manual docente E2E privado' not in ep.locator('main').inner_text(), '🚫 Oculto a una persona específica: los demás lo ven, ella no')
    check('Restringido' in row.inner_text() or 'Restringido' in o.content(), '📚 El personal ve la marca «🔒 Restringido»')

    # ================= 5. El propietario edita y elimina usuarios por rol =================
    go(o, f'{BASE}/app/usuarios')
    g = o.locator('form:has(button:has-text("Asignar rol"))')
    for i in (1, 2, 3):
        g.locator('input[name=email]').fill(f'temporal{i}.e2e@demo.sematec.test'); g.locator('input[name=full_name]').fill(f'Temporal {i} E2E')
        g.locator('select[name=role]').select_option('apoderado'); g.locator('input[name=password]').fill(PW)
        g.locator('button:has-text("Asignar rol")').click(); form_status(g); time.sleep(0.5)
    t1 = sql("select id from profiles where email = 'temporal1.e2e@demo.sematec.test'")
    check(re.match(r'^APOD\d{6}$', sql(f"select user_code from profiles where id = '{t1}'") or '') is not None, '🔢 El usuario nuevo recibe su código automático (APOD + 6 números)')
    go(o, f'{BASE}/app/usuarios?q=temporal1.e2e')
    row = o.locator('[data-testid=tabla-usuarios] tr:has-text("temporal1.e2e")')
    row.locator('[data-testid=editar-usuario] summary').click()
    ef = row.locator('form:has(input[name=full_name])')
    ef.locator('input[name=full_name]').fill('Temporal Uno Editado'); ef.locator('input[name=id_document_number]').fill('22.222.222-2'); ef.locator('input[name=phone]').fill('+56 9 1234 5678')
    ef.locator('select[name=role]').select_option('estudiante'); ef.locator('button:has-text("Guardar cambios")').click(); form_status(ef)
    check(sql(f"select full_name || '|' || id_document_number || '|' || phone from profiles where id = '{t1}'") == 'Temporal Uno Editado|22.222.222-2|+56 9 1234 5678'
          and sql(f"select r.code from memberships m join roles r on r.id = m.role_id where m.user_id = '{t1}' and m.organization_id = '{ORG}'") == 'estudiante',
          '✏ El propietario edita nombre, RUT, teléfono y cambia el rol')
    go(o, f'{BASE}/app/usuarios?q=temporal1.e2e')
    rf = o.locator('[data-testid=tabla-usuarios] tr:has-text("temporal1.e2e") form:has(button:has-text("Eliminar"))')
    rf.locator('input[name=reason]').fill('Ya no trabaja aquí'); rf.locator('button:has-text("Eliminar")').click()
    check(wait_sql(f"select status from profiles where id = '{t1}'", 'suspended') and sql(f"select count(*) from memberships where user_id = '{t1}' and status = 'active'") == '0',
          '🗑 Elimina al usuario del sistema (roles revocados y acceso bloqueado; historial conservado)')
    lc = b.new_context(); lp = lc.new_page(); go(lp, f'{BASE}/login')
    lp.fill('input[name=email]', 'temporal1.e2e@demo.sematec.test'); lp.fill('input[name=password]', PW); lp.click('button[type=submit]'); time.sleep(3)
    check('/login' in lp.url, '🔒 El usuario eliminado ya no puede entrar')

    go(o, f'{BASE}/app/usuarios?rol=apoderado&q=temporal')
    o.locator('[data-testid=sel-todos]').check()
    bf = o.locator('form#bulk'); bf.locator('select[name=bulk_action]').select_option('suspend'); bf.locator('input[name=bulk_reason]').fill('Fin de convenio')
    bf.locator('button:has-text("Aplicar")').click(); msg = form_status(bf)
    check(sql("select count(*) from profiles where email in ('temporal2.e2e@demo.sematec.test','temporal3.e2e@demo.sematec.test') and status = 'suspended'") == '2',
          f'👥 Acción en lote por rol: suspende a todos los apoderados filtrados ({msg})')
    go(o, f'{BASE}/app/usuarios?rol=apoderado&q=temporal')
    o.locator('[data-testid=sel-todos]').check()
    bf = o.locator('form#bulk'); bf.locator('select[name=bulk_action]').select_option('activate'); bf.locator('input[name=bulk_reason]').fill('Reincorporación')
    bf.locator('button:has-text("Aplicar")').click(); form_status(bf)
    check(sql("select count(*) from profiles where email in ('temporal2.e2e@demo.sematec.test','temporal3.e2e@demo.sematec.test') and status = 'active'") == '2', '👥 Y los reactiva en lote')
    go(o, f'{BASE}/app/usuarios?q=propietario.a@demo')
    own = o.locator('[data-testid=tabla-usuarios] tbody tr').first
    check(own.locator('form:has(button:has-text("Eliminar"))').count() == 0 and own.locator('input[name=sel]').count() == 0, '🛡 El propietario no puede eliminarse a sí mismo')
    b.close()

print(f"\n{sum(1 for ok, _ in results if ok)}/{len(results)} verificaciones OK")
