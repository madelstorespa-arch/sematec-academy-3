"""Certificados: editar el texto de la plantilla, texto adicional al emitir y editar un certificado emitido."""
import re, sys, os
sys.path.insert(0, os.path.dirname(__file__))
from e2e import BASE, CHROME, sql, check, shot, login, status_msg, go, results
from playwright.sync_api import sync_playwright

st1 = sql("select id from students where user_id = '00000000-0000-4000-8000-000000000030'")
with sync_playwright() as pw:
    b = pw.chromium.launch(executable_path=CHROME, headless=True, args=['--no-sandbox'])
    c = b.new_context(viewport={'width': 390, 'height': 844}, is_mobile=True); o = login(c, 'propietario.a@demo.sematec.test', mfa=True)
    go(o, BASE + '/app/certificados')
    d = o.locator('details:has(summary:has-text("Alumno regular"))').first
    d.locator('summary').click()
    d.locator('textarea[name=body_template]').fill('Es alumno regular del programa {{program}} durante el año académico 2026.\nSe extiende para los fines que estime conveniente.')
    d.locator('input[name=signer1_name]').fill('Manuel Stok'); d.locator('input[name=signer1_title]').fill('Director Académico')
    d.locator('input[name=city]').fill('Santiago, Chile')
    d.locator('button:has-text("Guardar plantilla")').click(); m = status_msg(o); check('Plantilla actualizada' in m, 'Edita el texto de la plantilla sin tocar código')
    go(o, BASE + '/app/certificados')
    tid = sql("select id from certificate_templates where certificate_type = 'enrollment' limit 1")
    o.select_option('select[name=template_id]', tid); o.select_option('select[name=student_id]', st1)
    o.fill('textarea[name=extra]', 'Con asistencia destacada.')
    o.click('button:has-text("Emitir")'); status_msg(o)
    cid = sql(f"select id from certificates where student_id = '{st1}' order by issued_at desc limit 1")
    go(o, f'{BASE}/app/certificados/{cid}')
    check(o.locator('text=durante el año académico 2026').count() >= 1 and o.locator('article >> text=Con asistencia destacada.').count() == 1
          and o.locator('text=Director Académico').count() == 1, 'El certificado muestra texto, texto adicional y firma')
    box = o.locator('article').bounding_box(); qr = o.locator('img[alt="Código QR de verificación"]').bounding_box()
    check(qr['x'] + qr['width'] <= box['x'] + box['width'], 'En el celular el QR queda dentro del marco')
    shot(o, 'cert_texto_celular')
    old = sql(f"select verification_code from certificates where id = '{cid}'")
    o.click('summary:has-text("Editar este certificado")')
    o.fill('textarea[name=extra]', 'Con asistencia destacada y 120 horas de práctica.'); o.fill('input[name=reason]', 'Se agregan las horas de práctica')
    o.once('dialog', lambda dl: dl.accept()); o.click('button:has-text("Guardar cambios")')
    o.wait_for_url(re.compile(r'editado=1'), timeout=20000)
    check(o.locator('article >> text=120 horas de práctica').count() == 1, 'Se edita el certificado emitido (versión corregida)')
    check(sql(f"select status from certificates where verification_code = '{old}'") == 'revoked', 'La versión anterior queda revocada como reemplazada')
    new = sql(f"select verification_code from certificates where student_id = '{st1}' and status = 'issued' order by issued_at desc limit 1")
    p = b.new_context().new_page(); go(p, f'{BASE}/verificar/{new}')
    check(p.locator('text=/válido|auténtico|vigente/i').count() >= 1, 'El certificado corregido se verifica como válido')
    # Descargar y enviar
    go(o, f'{BASE}/app/certificados/{cid}')
    check(o.locator('a:has-text("Descargar PDF")').count() == 1 and o.locator('button:has-text("Enviar")').count() == 1
          and o.locator('a:has-text("WhatsApp")').count() == 1 and o.locator('a:has-text("Correo")').count() == 1, 'Botones Descargar PDF, Enviar, WhatsApp y Correo')
    with o.expect_download() as dl: o.click('a:has-text("Descargar PDF")')
    path = dl.value.path(); data = open(path, 'rb').read()
    check(data[:5] == b'%PDF-' and len(data) > 3000 and dl.value.suggested_filename.endswith('.pdf'), f'Descarga un PDF real ({len(data)} bytes, {dl.value.suggested_filename})')
    open('/tmp/cert.pdf', 'wb').write(data)
    ec = b.new_context(); e = login(ec, 'estudiante1.a@demo.sematec.test')
    newid = sql(f"select id from certificates where verification_code = '{new}'")
    r = e.request.get(f'{BASE}/app/certificados/{newid}/pdf'); check(r.status == 200 and r.body()[:5] == b'%PDF-', 'El estudiante descarga su propio certificado')
    e2 = login(b.new_context(), 'estudiante2.a@demo.sematec.test')
    r = e2.request.get(f'{BASE}/app/certificados/{newid}/pdf'); check(r.status == 404, 'Otro estudiante no puede descargarlo')
    b.close()
print(f"\n{sum(1 for ok, _ in results if ok)}/{len(results)} pruebas OK")
