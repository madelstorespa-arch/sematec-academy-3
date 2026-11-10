"""Etapa C: sucursales separadas (un solo dueño), traslados, apertura y cierre de caja, clientes, reportes e idioma por usuario."""
import re, sys, os, time, subprocess
sys.path.insert(0, os.path.dirname(__file__))
from e2e import BASE, CHROME, sql, check, shot, login, status_msg, go, results
from playwright.sync_api import sync_playwright

ORG = '0a000000-0000-4000-8000-000000000001'
STGO, VALP = '0a000000-0000-4000-8000-0000000000c1', '0a000000-0000-4000-8000-0000000000c2'
U_SEC = '00000000-0000-4000-8000-000000000011'

def asu(uid, q, headers=None):
    pre = f"set request.headers = '{headers}'; " if headers else ''
    return subprocess.run(['bash', '/tmp/asu.sh', uid, pre + q], capture_output=True, text=True)

def wait_status(p, *words, timeout=20):
    end = time.time() + timeout
    while time.time() < end:
        t = ' | '.join(p.locator('[role=status]').all_inner_texts())
        if any(w in t for w in words): return t
        time.sleep(0.3)
    return ' | '.join(p.locator('[role=status]').all_inner_texts())

sql("update profiles set id_document_type = 'RUN', id_document_number = '17.654.321-3' where email = 'secretaria.a@demo.sematec.test' and id_document_number is null")
sql("update profiles set id_document_type = 'RUN', id_document_number = '18.765.432-7' where email = 'propietario.a@demo.sematec.test' and id_document_number is null")

with sync_playwright() as pw:
    b = pw.chromium.launch(executable_path=CHROME, headless=True, args=['--no-sandbox'])
    new = lambda: b.new_context(viewport={'width': 1440, 'height': 900}, accept_downloads=True)

    # ================= 🏢 Sucursales =================
    oc = new(); o = login(oc, 'propietario.a@demo.sematec.test', mfa=True)
    sel = o.locator('[data-testid=selector-sucursal] select')
    opts = sel.locator('option').all_inner_texts()
    check(any('Todas' in x for x in opts) and any('Santiago' in x for x in opts) and any('Valparaíso' in x for x in opts), '🏢 El dueño elige entre todas sus sucursales')
    sel.select_option(VALP); o.wait_for_load_state('networkidle'); time.sleep(1)
    def create_product(page, name, barcode, price, stock):
        go(page, f'{BASE}/app/tienda/productos')
        if page.locator('details:has-text("Nuevo producto")').first.get_attribute('open') is None: page.click('summary:has-text("Nuevo producto")')
        f = page.locator('form:has(button:has-text("Crear producto"))')
        f.locator('input[name=name]').fill(name); f.locator('label:has-text("Aseo y limpieza")').click(); f.locator('input[name=barcode]').fill(barcode)
        f.locator('input[name=price]').fill(str(price)); f.locator('input[name=cost]').fill(str(price // 2)); f.locator('input[name=initial_stock]').fill(str(stock))
        f.locator('button:has-text("Crear producto")').click(); return status_msg(page)
    msg = create_product(o, 'Agua mineral 500 ml', '7801111111111', 900, 20)
    check(sql("select c.code from products p join campuses c on c.id = p.campus_id where p.barcode = '7801111111111'") == 'VALP', f'🏢 Con Valparaíso elegida, el producto nuevo queda en esa sucursal ({msg[:60]})')
    o.locator('[data-testid=selector-sucursal] select').select_option(STGO); o.wait_for_load_state('networkidle'); time.sleep(1)
    msg = create_product(o, 'Agua mineral 500 ml', '7801111111111', 950, 5)
    check(sql("select count(*) from products where barcode = '7801111111111'") == '2', '🏢 El mismo código de barras puede existir en cada sucursal (cada una con su precio y stock)')
    go(o, f'{BASE}/app/tienda/productos')
    txt = o.locator('main').inner_text()
    check('950' in txt and '$900' not in txt, '🏢 Con Santiago elegida, solo se ven los productos de Santiago')

    # Aislamiento real en la base de datos: la secretaria trabaja solo en Santiago
    r = asu(U_SEC, f"select count(*) from products where campus_id = '{VALP}'")
    check(r.stdout.strip().splitlines()[-1] == '0', '🔒 Quien trabaja en Santiago no ve los productos de Valparaíso (base de datos)')
    pv0 = sql(f"select id from products where barcode = '7801111111111' and campus_id = '{VALP}'")
    r = asu(U_SEC, f"""select store_sell('{ORG}', '[{{"product":"{pv0}","qty":1}}]'::jsonb, 'cash', '{{}}'::jsonb, 0, 5000)""")
    check(r.returncode != 0 and 'otra sucursal' in r.stderr, f'🔒 Ni puede vender productos de otra sucursal ({r.stderr.strip()[-70:]})')
    r = asu(U_SEC, f"select private.active_campus('{ORG}')", '{"x-sucursal":"' + VALP + '"}')
    check(r.stdout.strip().splitlines()[-1] == STGO, '🔒 Aunque intente elegir otra sucursal, el sistema la mantiene en la suya')
    # 🔁 Traslado
    o.locator('[data-testid=selector-sucursal] select').select_option(VALP); o.wait_for_load_state('networkidle'); time.sleep(1)
    pv = sql("select id from products where barcode = '7801111111111' and campus_id = '" + VALP + "'")
    go(o, f'{BASE}/app/tienda/productos/{pv}')
    tf = o.locator('form:has(button:has-text("Trasladar"))')
    tf.locator('select[name=to]').select_option(STGO); tf.locator('input[name=qty]').fill('6'); tf.locator('button:has-text("Trasladar")').click()
    msg = wait_status(o, 'Trasladadas', '✕')
    st = sql("select string_agg(c.code || '=' || p.stock::int, ',' order by c.code) from products p join campuses c on c.id = p.campus_id where p.barcode = '7801111111111'")
    check(st == 'STGO=11,VALP=14', f'🔁 Traslada stock de Valparaíso a Santiago ({st})')

    # ================= 💵 Caja: apertura, venta y cierre =================
    sc = new(); s = login(sc, 'secretaria.a@demo.sematec.test')
    check('Sede Santiago' in s.locator('[data-testid=selector-sucursal]').inner_text() and s.locator('[data-testid=selector-sucursal] select').count() == 0, '🏢 La secretaria trabaja fija en su sucursal')
    go(s, f'{BASE}/app/tienda/caja')
    check('no está abierta' in s.locator('[data-testid=estado-caja]').inner_text(), '💵 La caja avisa que no está abierta')
    go(s, f'{BASE}/app/tienda/cierre'); s.fill('[data-testid=dinero-inicial]', '10000'); s.click('button:has-text("Abrir caja")'); wait_status(s, 'Caja abierta', '✕')
    s.wait_for_selector('[data-testid=caja-abierta]', timeout=15000); check(True, '💵 Abre su caja con $10.000 de sencillo')
    go(s, f'{BASE}/app/tienda/caja'); s.wait_for_selector('[data-testid=caja-buscar]')
    check(s.locator('[data-testid=caja-producto]:has-text("Agua mineral")').count() == 1, '🧾 La caja muestra solo los productos de su sucursal')
    s.locator('[data-testid=caja-producto]:has-text("Agua mineral")').click(); s.locator('[data-testid=caja-producto]:has-text("Agua mineral")').click()
    s.click('summary:has-text("Datos del cliente")'); s.fill('input[placeholder=Nombre]', 'María González'); s.fill('input[placeholder="RUT / pasaporte"]', '11.111.111-1')
    s.locator('button:has-text("Efectivo")').first.click()  # su medio preferido puede ser otro
    s.fill('[data-testid=caja-efectivo]', '2000'); s.click('[data-testid=cobrar]'); s.wait_for_selector('[data-testid=venta-lista]', timeout=20000)
    check(sql("select c.code from sales s join campuses c on c.id = s.campus_id order by s.created_at desc limit 1") == 'STGO', '🏢 La venta queda registrada en su sucursal')
    go(s, f'{BASE}/app/tienda/cierre')
    exp = s.locator('[data-testid=caja-abierta]').inner_text()
    check('11.900' in exp, '💵 Efectivo esperado = inicial + ventas en efectivo ($10.000 + $1.900)')
    s.fill('[data-testid=dinero-contado]', '11900'); s.once('dialog', lambda d: d.accept()); s.click('button:has-text("Cerrar caja")')
    s.wait_for_selector('[data-testid=ultimo-cierre]', timeout=20000)
    msg = s.locator('[data-testid=ultimo-cierre]').inner_text()
    check('cuadra perfecto' in msg, f'🔒 Cierra la caja y el arqueo cuadra ({msg[-40:]})')
    check(sql("select difference::int || '|' || sales_count from cash_sessions order by opened_at desc limit 1") == '0|1', '📋 El cierre queda guardado con la diferencia y las ventas del turno')

    # ================= 👥 Clientes y 📈 Reportes =================
    go(s, f'{BASE}/app/tienda/clientes')
    check('María González' in s.locator('[data-testid=tabla-clientes]').inner_text(), '👥 El cliente aparece con su total comprado')
    s.click('[data-testid=tabla-clientes] a:has-text("María González")')
    check('Agua mineral' in s.locator('[data-testid=historial-cliente]').inner_text(), '👥 Y su historial de compras')
    sc.close()
    go(o, f'{BASE}/app/tienda/reportes')
    o.locator('[data-testid=selector-sucursal] select').select_option(''); o.wait_for_load_state('networkidle'); time.sleep(1)
    go(o, f'{BASE}/app/tienda/reportes')
    check('Sede Santiago' in o.locator('[data-testid=ventas-sucursal]').inner_text() and 'Agua mineral' in o.locator('[data-testid=top-productos]').inner_text(), '📈 Reportes: ventas por sucursal y productos más vendidos')
    go(o, f'{BASE}/app/sucursales')
    cards = o.locator('[data-testid=tarjeta-sucursal]').all_inner_texts()
    today = int(float(sql(f"select coalesce(sum(total), 0) from sales where campus_id = '{STGO}' and status <> 'anulada' and created_at >= date_trunc('day', now() at time zone 'America/Santiago') at time zone 'America/Santiago'")))
    fmt = f"{today:,}".replace(',', '.')
    check(len(cards) == 3 and any('Santiago' in c and fmt in c for c in cards) and today >= 1900, f'🏢 Panel de sucursales: cada una con sus ventas, aranceles, gastos y resultado (Santiago hoy ${fmt})')
    shot(o, 'sucursales')
    oc.close()

    # ================= 🌐 Idioma por usuario =================
    ec = new(); e = login(ec, 'estudiante1.a@demo.sematec.test')
    e.locator('[data-testid=idioma] select').select_option('en'); e.wait_for_load_state('networkidle'); time.sleep(1.5); e.reload(); e.wait_for_load_state('networkidle')
    nav = e.locator('aside nav').first.inner_text()
    check('Home' in nav and 'My account' in nav and 'Settings' in nav, '🌐 El estudiante cambia su plataforma a inglés (menú traducido)')
    check(e.locator('[data-testid=traductor]').count() == 1, '🌐 El traductor del navegador se activa para el resto de la página (o explica cómo)')
    check(sql("select preferences->>'locale' || '|' || preferred_locale from profiles where email = 'estudiante1.a@demo.sematec.test'") == 'en|en', '🌐 Su idioma queda guardado en su cuenta')
    pc = new(); p = login(pc, 'profesor1.a@demo.sematec.test')
    check('Inicio' in p.locator('aside nav').first.inner_text(), '🌐 El idioma de una persona no cambia el de las demás')
    pc.close()
    # Traductor de documentos
    go(e, f'{BASE}/app/traducir')
    with open('/tmp/media/carta.txt', 'w', encoding='utf-8') as f: f.write('Estimado apoderado:\n\nLa reunión será el lunes a las 18:00 horas.')
    e.locator('[data-testid=doc-traducir]').set_input_files('/tmp/media/carta.txt')
    e.wait_for_selector('[data-testid=estado-traduccion]:has-text("Documento cargado")', timeout=15000)
    check('reunión será el lunes' in e.locator('[data-testid=texto-original]').input_value(), '📄 Carga un documento de texto para traducir')
    sale_pdf = '/tmp/media/boleta.pdf'
    with open(sale_pdf, 'wb') as f:
        oc2 = new(); o2 = login(oc2, 'propietario.a@demo.sematec.test', mfa=True)
        sid = sql("select id from sales order by created_at desc limit 1")
        f.write(o2.request.get(f'{BASE}/app/tienda/ventas/{sid}/pdf').body()); oc2.close()
    e.locator('[data-testid=doc-traducir]').set_input_files(sale_pdf)
    e.wait_for_selector('[data-testid=estado-traduccion]:has-text("Documento cargado")', timeout=20000)
    check('BOLETA' in e.locator('[data-testid=texto-original]').input_value(), '📄 Extrae el texto de un PDF para traducirlo')
    e.click('[data-testid=boton-traducir]')
    e.wait_for_selector('[data-testid=estado-traduccion]', timeout=15000)
    st = e.locator('[data-testid=estado-traduccion]').inner_text()
    check('Traducción lista' in st or 'navegador' in st or 'Preparando' in st, f'🌐 Traduce en el navegador, o explica qué navegador usar ({st[:70]})')
    e.locator('[data-testid=idioma] select').select_option('es'); e.wait_for_load_state('networkidle')
    ec.close()

ok = sum(1 for r in results if r[0]); print(f'\n{ok}/{len(results)} verificaciones OK')
