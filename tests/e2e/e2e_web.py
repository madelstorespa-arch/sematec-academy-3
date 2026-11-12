"""
Pruebas de punta a punta del sitio público, pagos en línea (Webpay, Mercado Pago,
Flow, Stripe contra el servidor de pruebas tests/e2e/payment-mock.mjs), postulación,
contacto, marca editable y foto de perfil.
"""
import io, os, re, sys, json, time, urllib.request
sys.path.insert(0, os.path.dirname(__file__))
from e2e import BASE, PASS, CHROME, sql, check, shot, login, status_msg, sel_re, go, results
from playwright.sync_api import sync_playwright, expect
from PIL import Image

NEWPASS = 'MiClave-Segura-2026'

def png(color, size=(400, 140)):
    path = f'/tmp/img_{color.strip("#")}.png'
    Image.new('RGB', size, color).save(path); return path

def form_msg(page, form_sel):
    loc = page.locator(f'{form_sel} [role=status]')
    loc.wait_for(timeout=20000)
    return loc.inner_text()

def buy(browser, provider, email, doc, button='#approve', slug='sql-desde-cero', code=None, expect_paid=True):
    c = browser.new_context(viewport={'width': 1366, 'height': 900}); p = c.new_page()
    go(p, f'{BASE}/cursos/{slug}/inscripcion' + (f'?codigo={code}' if code else ''))
    if not code:
        p.fill('input[name=name]', f'Comprador {provider.title()}'); p.fill('input[name=email]', email); p.fill('input[name=doc_number]', '13.131.313-6')
    else:
        p.fill('input[name=name]', 'Postulante Web'); p.fill('input[name=email]', email)
    p.check(f'input[name=provider][value={provider}]'); p.check('input[name=consent]')
    p.click('button:has-text("Ir a pagar")')
    p.wait_for_selector('#provider', timeout=20000)
    shot(p, f'web_pasarela_{provider}')
    p.click(button)
    p.wait_for_url(re.compile(r'/pago/resultado/'), timeout=30000)
    p.wait_for_load_state('networkidle')
    if expect_paid:
        try: p.wait_for_selector('text=¡Pago aprobado!', timeout=15000)
        except Exception: pass
    return c, p

def main():
    with sync_playwright() as pw:
        b = pw.chromium.launch(executable_path=CHROME, headless=True, args=['--no-sandbox'])
        new = lambda: b.new_context(viewport={'width': 1366, 'height': 900})

        # 1. Sitio público sin sesión
        c = new(); p = c.new_page(); go(p, BASE + '/')
        check(p.locator('h1').first.inner_text().startswith('Aprende tecnología'), 'Página de inicio pública visible sin iniciar sesión')
        check(p.locator('text=$89.000').count() >= 1, 'Precios de cursos visibles en la portada')
        shot(p, 'web_01_inicio')
        go(p, BASE + '/cursos'); shot(p, 'web_02_cursos')
        go(p, BASE + '/cursos/sql-desde-cero'); check(p.locator('text=Inscribirme y pagar').count() == 1, 'Detalle de curso con botón de compra'); shot(p, 'web_03_curso')
        go(p, BASE + '/nosotros'); check(p.locator('text=Misión').count() == 1, 'Página Nosotros con misión y visión')
        # Contacto
        go(p, BASE + '/contacto')
        p.fill('input[name=name]', 'Ana Interesada'); p.fill('input[name=email]', 'ana.contacto@demo.sematec.test')
        p.fill('input[name=subject]', 'Consulta por becas'); p.fill('textarea[name=message]', '¿Tienen becas para el curso de SQL?')
        p.check('input[name=consent]'); p.click('button:has-text("Enviar mensaje")')
        check('Recibimos su mensaje' in status_msg(p), 'Formulario de contacto enviado'); shot(p, 'web_04_contacto')
        check(sql("select count(*) from contact_messages where email='ana.contacto@demo.sematec.test'") == '1', 'Mensaje guardado en la base de datos')
        c.close()

        # 2. Compra directa con cada medio de pago
        for i, prov in enumerate(['webpay', 'mercadopago', 'flow', 'stripe']):
            email = f'compra.{prov}@demo.sematec.test'
            c, p = buy(b, prov, email, f'WEB-{1000 + i}')
            check(p.locator('text=¡Pago aprobado!').count() == 1, f'{prov}: pago aprobado y verificado con el proveedor')
            row = sql(f"select status||'|'||(enrollment_id is not null)||'|'||(payment_id is not null) from checkout_orders where buyer_email='{email}'")
            check(row == 'paid|true|true', f'{prov}: pedido pagado con matrícula y pago contable creados ({row})')
            if prov == 'webpay': shot(p, 'web_05_pago_aprobado')
            # crear contraseña y entrar
            p.click('button:has-text("Crear mi contraseña y entrar")'); p.wait_for_selector('text=Nueva contraseña', timeout=30000)
            p.fill('input[name=password]', NEWPASS); p.fill('input[name=confirm]', NEWPASS); p.click('button:has-text("Guardar contraseña")')
            check('actualizada' in status_msg(p), f'{prov}: comprador crea su contraseña')
            go(p, BASE + '/app/mi'); check('/app/mi' in p.url, f'{prov}: comprador accede a su portal de estudiante')
            if prov == 'webpay': shot(p, 'web_06_portal_comprador')
            c.close()
        check(sql("select count(*) from payments where method='payment_gateway' and status='confirmed'") == '4', 'Los 4 pagos quedan registrados en Finanzas')
        # el enlace de acceso es de un solo uso
        oid = sql("select id from checkout_orders where buyer_email='compra.webpay@demo.sematec.test'")
        check(sql(f"select access_link_used from checkout_orders where id='{oid}'") == 't', 'Enlace para crear contraseña es de un solo uso')
        c = new(); p = c.new_page(); r = p.goto(f'{BASE}/pago/resultado/{oid}?t=token-falso')
        check(r.status == 404, 'Resultado de pago protegido: token inválido devuelve 404'); c.close()

        # 3. Pagos rechazados, anulados y monto alterado
        c, p = buy(b, 'webpay', 'rechazo@demo.sematec.test', 'WEB-2001', '#reject', expect_paid=False)
        check(p.locator('text=El pago no fue aprobado').count() == 1, 'Webpay rechazado: se informa y no se matricula')
        shot(p, 'web_07_pago_rechazado'); c.close()
        c, p = buy(b, 'webpay', 'anula@demo.sematec.test', 'WEB-2002', '#cancel', expect_paid=False)
        check(p.locator('text=Pago anulado').count() == 1, 'Webpay anulado por el comprador'); c.close()
        c, p = buy(b, 'webpay', 'altera@demo.sematec.test', 'WEB-2003', '#tamper', expect_paid=False)
        check(sql("select status||'|'||provider_status from checkout_orders where buyer_email='altera@demo.sematec.test'") == 'failed|amount_mismatch',
              'Monto alterado detectado: pedido rechazado')
        check(int(sql("select count(*) from system_events where event_type='payment_amount_mismatch'")) >= 1, 'Alerta crítica registrada por monto alterado')
        check(sql("select count(*) from students where email in ('rechazo@demo.sematec.test','anula@demo.sematec.test','altera@demo.sematec.test')") == '0', 'Pagos no aprobados no crean matrícula'); c.close()
        # webhook falso
        req = urllib.request.Request(f'{BASE}/api/pago/webhook/stripe', data=b'{"type":"checkout.session.completed"}', headers={'Stripe-Signature': 't=1,v1=falso'}, method='POST')
        try: urllib.request.urlopen(req); code = 200
        except urllib.error.HTTPError as e: code = e.code
        check(code == 401, 'Webhook con firma falsa rechazado (401)')

        # 4. Postulación → aprobación → pago
        c = new(); p = c.new_page(); go(p, BASE + '/cursos/tecnico-informatica/inscripcion')
        p.fill('input[name=name]', 'Pablo Postulante'); p.fill('input[name=email]', 'pablo.post@demo.sematec.test')
        p.fill('input[name=doc_number]', '15.151.515-0'); p.fill('input[name=education]', 'Enseñanza media completa'); p.fill('textarea[name=motivation]', 'Quiero trabajar en desarrollo de software')
        p.check('input[name=consent]'); p.click('button:has-text("Enviar postulación")')
        p.wait_for_selector('text=Postulación recibida'); code = re.search(r'SA-[A-Z0-9]{8}', p.inner_text('body')).group(0)
        check(bool(code), f'Postulación enviada con código de seguimiento {code}'); shot(p, 'web_08_postulacion')
        go(p, f'{BASE}/estado?codigo={code}'); p.fill('input[name=email]', 'pablo.post@demo.sematec.test'); p.click('button:has-text("Consultar")')
        p.wait_for_selector('text=Recibida, en revisión'); check(p.locator('text=Pagar ahora').count() == 0, 'Estado: en revisión, aún sin opción de pago')
        shot(p, 'web_09_estado_revision')
        # Intento de pagar sin aprobación (manipulando la URL)
        go(p, f'{BASE}/cursos/tecnico-informatica/inscripcion?codigo={code}')
        p.fill('input[name=name]', 'Pablo'); p.fill('input[name=email]', 'pablo.post@demo.sematec.test')
        p.check('input[name=provider][value=webpay]'); p.check('input[name=consent]'); p.click('button:has-text("Ir a pagar")')
        check('postulación aprobada' in status_msg(p), 'No se puede pagar una postulación no aprobada')
        c.close()
        ca = new(); pa = login(ca, 'director.a@demo.sematec.test', mfa=True)
        go(pa, BASE + '/app/admision'); shot(pa, 'web_10_admision')
        pa.locator(f'tr:has-text("{code}") select[name=decision]').select_option('approve')
        pa.locator(f'tr:has-text("{code}") input[name=notes]').fill('Bienvenido, cumple los requisitos')
        pa.locator(f'tr:has-text("{code}") button:has-text("Aplicar")').click()
        check('aprobada' in status_msg(pa), 'Admisión aprueba la postulación'); ca.close()
        c = new(); p = c.new_page(); go(p, f'{BASE}/estado?codigo={code}')
        p.fill('input[name=email]', 'pablo.post@demo.sematec.test'); p.click('button:has-text("Consultar")')
        p.wait_for_selector('text=Pagar ahora'); check(p.locator('text=Bienvenido, cumple los requisitos').count() == 1, 'Estado: aprobada con observación y botón de pago')
        shot(p, 'web_11_estado_aprobada'); c.close()
        c, p = buy(b, 'webpay', 'pablo.post@demo.sematec.test', 'WEB-3001', code=code, slug='tecnico-informatica')
        check(p.locator('text=¡Pago aprobado!').count() == 1, 'Postulante aprobado paga con Webpay')
        check(sql(f"select (student_id is not null) from applications where tracking_code='{code}'") == 't', 'Postulación vinculada a la ficha del estudiante'); c.close()
        # Estado final
        c = new(); p = c.new_page(); go(p, f'{BASE}/estado?codigo={code}')
        p.fill('input[name=email]', 'pablo.post@demo.sematec.test'); p.click('button:has-text("Consultar")')
        p.wait_for_selector('text=Matrícula activa'); check(True, 'Estado: pagado y matrícula activa'); c.close()

        # 5. Marca editable sin código: nombre, color, logo
        co = new(); po = login(co, 'propietario.a@demo.sematec.test', mfa=True)
        go(po, BASE + '/app/sitio')
        po.fill('input[name=site_name]', 'SEMATEC ACADEMY CHILE'); po.fill('input[name=primary_color]', '#7c3aed')
        po.click('button:has-text("Guardar sitio")'); check('publicado' in status_msg(po), 'Nombre y color de la academia guardados')
        po.locator('form:has(input[value=logo]) input[type=file]').set_input_files(png('#7c3aed'))
        po.click('button:has-text("Subir logo")'); check('Logo actualizado' in form_msg(po, 'form:has(input[value=logo])'), 'Logo subido desde el panel')
        po.locator('form:has(input[value=logo]) input[type=file]').set_input_files({'name': 'virus.png', 'mimeType': 'image/png', 'buffer': b'<script>alert(1)</script>'})
        po.wait_for_timeout(500); po.click('button:has-text("Subir logo")'); po.locator('form:has(input[value=logo]) [role=status]:has-text("Formato")').wait_for(timeout=20000)
        check(True, 'Archivo falso con extensión .png rechazado')
        go(po, BASE + '/app/sitio'); shot(po, 'web_12_admin_marca')
        # nuevo curso desde el panel
        go(po, BASE + '/app/sitio/cursos'); po.click('summary:has-text("Nuevo curso")')
        po.fill('input[name=title]', 'Excel para la gestión'); po.fill('input[name=slug]', 'excel-gestion'); po.fill('input[name=regular_price]', '49990')
        sel_re(po, 'select[name=program_id]', 'TIN'); sel_re(po, 'select[name=period_id]', '2026-2')
        po.fill('textarea[name=summary]', 'Tablas dinámicas, fórmulas y paneles.'); po.check('input[name=is_published]')
        po.click('button:has-text("Crear curso")'); check('Curso creado' in status_msg(po), 'Curso nuevo con precio creado desde el panel')
        shot(po, 'web_13_admin_cursos')
        go(po, BASE + '/app/admision?t=mensajes'); check(po.locator('text=Consulta por becas').count() == 1, 'Mensaje de contacto visible en el panel')
        go(po, BASE + '/app/admision?t=pedidos'); shot(po, 'web_14_compras')
        co.close()
        c = new(); p = c.new_page(); go(p, BASE + '/')
        check(p.locator('header >> text=CHILE').count() >= 1 and p.locator('header img').count() == 1, 'Sitio público muestra el nuevo nombre y el logo')
        check(p.locator('text=Excel para la gestión').count() >= 1 and p.locator('text=$49.990').count() >= 1, 'Curso nuevo publicado con su precio')
        shot(p, 'web_15_inicio_marca_nueva')
        go(p, BASE + '/login'); check(p.locator('img').count() >= 1, 'Inicio de sesión muestra el logo de la academia'); c.close()

        # 6. Foto de perfil
        cs = new(); ps = login(cs, 'estudiante1.a@demo.sematec.test'); go(ps, BASE + '/app/perfil')
        ps.locator('input[name=file]').set_input_files(png('#10b5a3', (300, 300)))
        ps.click('button:has-text("Subir foto")'); check('Foto de perfil actualizada' in status_msg(ps), 'Foto de perfil subida')
        go(ps, BASE + '/app/perfil'); check(ps.locator('aside img[src^="/media/"]').count() >= 1, 'Foto visible en el menú')
        shot(ps, 'web_16_perfil_foto')
        aid = sql("select avatar_asset_id from profiles where email='estudiante1.a@demo.sematec.test'")
        cs.close()
        c = new(); r = c.request.get(f'{BASE}/media/{aid}'); check(r.status == 404, 'Foto de perfil no visible sin sesión'); c.close()
        b.close()
    ok = sum(1 for r in results if r[0])
    print(f'\nVerificaciones sitio público y pagos: {ok}/{len(results)}')

if __name__ == '__main__':
    try: main()
    except Exception as e:
        print('ERROR:', e); ok = sum(1 for r in results if r[0]); print(f'\nVerificaciones sitio público y pagos: {ok}/{len(results)} (interrumpido)'); sys.exit(1)
