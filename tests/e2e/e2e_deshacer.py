"""Deshacer / Rehacer (botones y Ctrl+Z / Ctrl+Y), Papelera e Historial de versiones."""
import re, sys, os
sys.path.insert(0, os.path.dirname(__file__))
from e2e import BASE, CHROME, sql, check, login, status_msg, go, results
from playwright.sync_api import sync_playwright

ORG = '0a000000-0000-4000-8000-000000000001'
SEC = 'secretaria.a@demo.sematec.test'

def undo_msg(p):
    loc = p.locator('[data-testid=undo-msg]'); loc.wait_for(timeout=20000); return loc.inner_text()

def wait_name(prog, expected, tries=40):
    import time
    for _ in range(tries):
        if sql(f"select name from programs where id = '{prog}'") == expected: return True
        time.sleep(0.25)
    return False

with sync_playwright() as pw:
    b = pw.chromium.launch(executable_path=CHROME, headless=True, args=['--no-sandbox'])
    oc = b.new_context(viewport={'width': 1366, 'height': 900}); o = login(oc, 'propietario.a@demo.sematec.test', mfa=True)

    # --- Crear y editar una carrera: aparece el aviso con «Deshacer» ---
    go(o, BASE + '/app/academico')
    check(o.locator('[data-testid=barra-deshacer] button:has-text("Deshacer")').count() == 1, 'Barra ↶ Deshacer / ↷ Rehacer visible en el sistema')
    check(o.locator('a:has-text("Papelera")').count() >= 1, 'El propietario ve «Papelera» en el menú')
    o.fill('input[name=code]', 'UND-E2E'); o.fill('input[name=name]', 'Carrera Original')
    o.select_option('select[name=level]', 'technical'); o.fill('input[name=duration_terms]', '4'); o.fill('input[name=valid_from]', '2026-03-01'); o.locator('select[name=grade_scale_id]').select_option(index=1)
    o.click('button:has-text("Crear carrera")'); status_msg(o)
    prog = sql("select id from programs where code = 'UND-E2E'")
    toast = o.locator('[data-testid=undo-toast]'); toast.wait_for(timeout=15000)
    check('Crear carrera' in toast.inner_text() and 'Carrera Original' in toast.inner_text(), f'Aviso tras guardar con opción de deshacer ({toast.inner_text()[:60]})')

    go(o, BASE + '/app/academico'); row = o.locator('tr:has-text("UND-E2E")')
    row.locator('summary:has-text("Editar")').click(); row.locator('input[name=name]').fill('Carrera Editada')
    row.locator('button:has-text("Guardar")').click(); status_msg(o)
    check(wait_name(prog, 'Carrera Editada'), 'Carrera editada')
    o.locator('[data-testid=undo-toast]').wait_for(timeout=15000)

    # --- Botón ↶ Deshacer y ↷ Rehacer ---
    bar = o.locator('[data-testid=barra-deshacer]')
    bar.locator('button:has-text("Deshacer")').click(); m = undo_msg(o)
    check(m.startswith('✓ Deshecho') and wait_name(prog, 'Carrera Original'), f'↶ Deshacer devuelve el nombre anterior ({m[:60]})')
    bar.locator('button:has-text("Rehacer"):not([disabled])').wait_for(timeout=15000)
    bar.locator('button:has-text("Rehacer")').click()
    o.wait_for_timeout(500); m = undo_msg(o)
    check('Rehecho' in m and wait_name(prog, 'Carrera Editada'), f'↷ Rehacer vuelve a aplicar el cambio ({m[:60]})')

    # --- Teclado: Ctrl+Z / Ctrl+Y (fuera de los campos de texto) ---
    go(o, BASE + '/app/academico'); o.locator('h1').click()
    o.keyboard.press('Control+z')
    check(wait_name(prog, 'Carrera Original'), 'Ctrl+Z deshace el último cambio')
    o.wait_for_timeout(800); o.locator('h1').click(); o.keyboard.press('Control+y')
    check(wait_name(prog, 'Carrera Editada'), 'Ctrl+Y rehace')
    o.wait_for_timeout(800)
    o.locator('input[name=code]').first.click(); o.keyboard.type('XYZ'); o.keyboard.press('Control+z'); o.wait_for_timeout(1500)
    check(sql(f"select name from programs where id = '{prog}'") == 'Carrera Editada', 'Ctrl+Z dentro de un campo de texto solo deshace lo escrito')

    # --- Conflicto: si otra persona cambió el registro después, no se pisa su trabajo ---
    sql(f"update programs set name = 'Cambio de otra persona' where id = '{prog}'")
    go(o, BASE + '/app/academico')
    lbl = o.locator('[data-testid=barra-deshacer] button:has-text("Deshacer")').get_attribute('title') or ''
    check('Carrera Editada' not in lbl, f'Lo modificado después por otro no se ofrece para deshacer ({lbl[:60]})')

    # --- Eliminar → Papelera → Restaurar (asignatura) ---
    go(o, BASE + '/app/academico?t=cursos')
    f = o.locator('form:has(button:has-text("Crear asignatura"))')
    f.locator('input[name=code]').fill('UNDASG'); f.locator('input[name=name]').fill('Asignatura Papelera E2E')
    f.locator('input[name=credits]').fill('4'); f.locator('input[name=weekly_hours]').fill('3')
    f.locator('button:has-text("Crear asignatura")').click(); status_msg(o)
    asg = sql("select id from courses where code = 'UNDASG'")
    go(o, BASE + '/app/academico?t=cursos'); o.once('dialog', lambda d: d.accept())
    o.locator('tr:has-text("UNDASG") button:has-text("Eliminar")').click(); status_msg(o)
    check(sql(f"select count(*) from courses where id = '{asg}'") == '0', 'Propietario elimina una asignatura')
    go(o, BASE + '/app/papelera')
    filas = o.locator('[data-testid=papelera-fila]:has-text("Asignatura Papelera E2E")'); n0 = filas.count()
    fila = filas.first
    check(n0 >= 1 and 'Eliminar asignatura' in fila.inner_text(), 'La asignatura eliminada aparece en la Papelera')
    fila.locator('button:has-text("Restaurar")').click(); m = status_msg(o)
    check(m.startswith('✓ Restaurado') and sql(f"select name || '|' || credits from courses where id = '{asg}'").startswith('Asignatura Papelera E2E|4'), f'♻ Restaurar la devuelve con el mismo registro y datos ({m[:50]})')
    go(o, BASE + '/app/papelera')
    check(o.locator('[data-testid=papelera-fila]:has-text("Asignatura Papelera E2E")').count() == n0 - 1, 'Ya no aparece en la Papelera tras restaurarla')
    o.locator('[data-testid=barra-deshacer] button:has-text("Deshacer")').click(); m = undo_msg(o)
    check('Restaurar' in m or 'Eliminar asignatura' in m, f'El último cambio a deshacer es la restauración ({m[:60]})')
    check(sql(f"select count(*) from courses where id = '{asg}'") == '0', '↶ Deshacer la restauración la elimina de nuevo')
    go(o, BASE + '/app/papelera')
    check(o.locator('[data-testid=papelera-fila]:has-text("Asignatura Papelera E2E")').count() == n0, 'Y vuelve a aparecer en la Papelera')
    o.locator('[data-testid=barra-deshacer] button:has-text("Rehacer"):not([disabled])').wait_for(timeout=15000)
    o.locator('[data-testid=barra-deshacer] button:has-text("Rehacer")').click(); o.wait_for_timeout(800)
    check(sql(f"select count(*) from courses where id = '{asg}'") == '1', '↷ Rehacer la restaura de nuevo')

    # --- Historial de versiones ---
    go(o, BASE + '/app/academico')
    o.locator('tr:has-text("UND-E2E") a:has-text("Historial")').click(); o.wait_for_url(re.compile(r'/app/historial/programs/'))
    o.wait_for_load_state('networkidle')
    vers = o.locator('[data-testid=version]')
    check(vers.count() >= 6, f'Historial muestra cada versión ({vers.count()})')
    check(o.locator('text=Carrera Original').count() >= 1 and o.locator('text=Versión actual').count() == 1, 'Muestra antes → después y la versión actual')
    o.once('dialog', lambda d: d.accept())
    vers.filter(has=o.locator('text=Creado')).first.locator('button:has-text("Volver a esta versión")').click(); m = status_msg(o)
    check(m.startswith('✓') and sql(f"select name from programs where id = '{prog}'") == 'Carrera Original', f'↺ Volver a la versión original ({m[:50]})')

    # --- Secretaría: deshace lo suyo, pero no ve la papelera ni el historial ---
    sc = b.new_context(viewport={'width': 390, 'height': 844}, is_mobile=True); s = login(sc, SEC)
    go(s, BASE + '/app/anuncios'); s.click('summary:has-text("Publicar anuncio")')
    s.fill('input[name=title]', 'Anuncio por error E2E'); s.fill('textarea[name=body]', 'Este anuncio se publicó por error.')
    s.click('button:has-text("Publicar")'); status_msg(s)
    check(sql("select count(*) from announcements where title = 'Anuncio por error E2E'") == '1', 'Secretaría publica un anuncio (celular)')
    t = s.locator('[data-testid=undo-toast]'); t.wait_for(timeout=15000)
    t.locator('button:has-text("Deshacer")').click(); m = undo_msg(s)
    check('Deshecho' in m and sql("select count(*) from announcements where title = 'Anuncio por error E2E'") == '0', f'Desde el aviso del celular deshace la publicación ({m[:50]})')
    go(s, BASE + '/app/papelera'); check('/app/papelera' not in s.url, 'Secretaría no puede abrir la Papelera')
    go(s, f'{BASE}/app/historial/programs/{prog}'); check('/app/historial' not in s.url, 'Secretaría no puede abrir el Historial')
    sec_id = sql(f"select id from auth.users where email = '{SEC}'")
    claims = f"set local role authenticated; set local request.jwt.claims = '{{\"sub\":\"{sec_id}\",\"role\":\"authenticated\",\"aal\":\"aal2\"}}';"
    def as_sec(q):
        try: return sql(f"begin; {claims} {q}; commit;")
        except Exception as e: return 'ERROR ' + str(getattr(e, 'stderr', e))
    check('propietario' in as_sec(f"select * from trash_list('{ORG}')"), 'La base rechaza la papelera a quien no es propietario')
    ev = sql(f"select id from audit_events where table_name = 'programs' and record_id = '{prog}' order by id limit 1")
    check('propietario' in as_sec(f"select restore_version({ev})"), 'La base rechaza restaurar versiones a quien no es propietario')
    owner_tx = sql(f"select tx_id from audit_events where table_name = 'programs' and record_id = '{prog}' and tx_id is not null order by id desc limit 1")
    check('ERROR' in as_sec(f"select restore_change('{ORG}', {owner_tx})"), 'Nadie puede deshacer cambios de otra persona (salvo el propietario)')

    # --- Registros protegidos: pagos, notas y certificados no se deshacen con el botón ---
    bl = sql("select private.undo_blocked_tables()")
    check(all(t in bl for t in ['payments', 'charges', 'installments', 'grades', 'academic_records', 'certificates', 'audit_events', 'quiz_attempts']),
          'Pagos, cuotas, notas, actas, certificados y la auditoría están protegidos')
    check(sql("select count(*) from audit_events where reason like 'Deshacer:%' or reason like 'Rehacer:%' or reason like 'Restaurar%'") != '0', 'Cada deshacer, rehacer y restauración queda en la Auditoría con su motivo')
    oid = '00000000-0000-4000-8000-000000000010'
    ok = sql(f"begin; set local role authenticated; set local request.jwt.claims = '{{\"sub\":\"{oid}\",\"role\":\"authenticated\",\"aal\":\"aal2\"}}'; select ok from verify_audit_chain('{ORG}'); commit;").split('\n')[-2:]
    check('t' in ok, f'La cadena de auditoría sigue íntegra ({ok})')
    b.close()

print(f"\n{sum(1 for r in results if r[0])}/{len(results)} verificaciones OK")
