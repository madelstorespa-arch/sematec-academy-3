"""Tienda: productos de aseo, comestibles (vencimiento por lote), electrónica (garantía y N° de serie); compras con gasto;
caja con código de barras, efectivo y vuelto; comprobante; anulación; tienda web con carro, pago por transferencia y en línea;
gestión de pedidos; resumen, alertas, balance financiero y búsqueda."""
import re, sys, os, time, datetime, json
sys.path.insert(0, os.path.dirname(__file__))
from e2e import BASE, CHROME, sql, check, login, results
from playwright.sync_api import sync_playwright

ORG = '0a000000-0000-4000-8000-000000000001'
def go(page, url): page.goto(url); page.wait_for_load_state('load')
def form_status(form):
    loc = form.locator('[role=status]'); loc.wait_for(timeout=20000); return loc.inner_text()
def stock(sku): return float(sql(f"select stock from products where organization_id = '{ORG}' and sku = '{sku}'") or 0)
d10 = (datetime.date.today() + datetime.timedelta(days=10)).isoformat()
d60 = (datetime.date.today() + datetime.timedelta(days=60)).isoformat()

sql("delete from system_events where event_type like 'rate:%'")
sql(f"update site_settings set is_published = true where organization_id = '{ORG}'")
for t in ['sale_items', 'stock_movements', 'purchase_items', 'product_lots']: sql(f"delete from {t} where organization_id = '{ORG}'")
sql(f"delete from sales where organization_id = '{ORG}' and id not in (select sale_id from checkout_orders where sale_id is not null)"); sql(f"delete from purchases where organization_id = '{ORG}'")
sql(f"delete from expenses where organization_id = '{ORG}' and category = 'mercaderia'"); sql(f"delete from products where organization_id = '{ORG}'")

def new_product(p, kind, name, sku, price, cost, initial, barcode='', minimum='0', expires=None, lot=None, warranty=None, serial=False):
    det = p.locator('details:has-text("Nuevo producto")')
    if det.get_attribute('open') is None: det.locator('summary').click()
    f = det.locator('form')
    f.locator(f'label:has(input[name=kind][value={kind}])').click()
    f.locator('input[name=name]').fill(name); f.locator('input[name=sku]').fill(sku); f.locator('input[name=barcode]').fill(barcode)
    f.locator('input[name=price]').fill(str(price)); f.locator('input[name=cost]').fill(str(cost)); f.locator('input[name=min_stock]').fill(minimum)
    f.locator('input[name=initial_stock]').fill(str(initial))
    if expires: f.locator('input[name=expires]').fill(expires); f.locator('input[name=lot]').fill(lot or '')
    if warranty is not None: f.locator('input[name=warranty_months]').fill(str(warranty))
    if serial: f.locator('input[name=requires_serial]').check()
    f.locator('button:has-text("Crear producto")').click()
    return form_status(f)

with sync_playwright() as pw:
    b = pw.chromium.launch(executable_path=CHROME, headless=True, args=['--no-sandbox'])
    tc = b.new_context(viewport={'width': 1366, 'height': 900}); t = login(tc, 'tesoreria.a@demo.sematec.test', mfa=True); t.on('dialog', lambda d: d.accept())

    # ================= 1. Productos =================
    go(t, f'{BASE}/app/tienda/productos')
    check(t.locator('nav a:has-text("Tienda y caja")').count() == 1, '🛒 Menú «Tienda y caja» para tesorería')
    new_product(t, 'aseo', 'Detergente líquido 3 L E2E', 'DET-E2E', 4990, 3000, 20, barcode='7800000000017', minimum='5')
    go(t, f'{BASE}/app/tienda/productos')
    new_product(t, 'comestible', 'Galletas de avena E2E', 'GAL-E2E', 1290, 700, 10, barcode='7800000000024', minimum='3', expires=d10, lot='L1')
    go(t, f'{BASE}/app/tienda/productos')
    new_product(t, 'electronica', 'Audífonos Bluetooth E2E', 'AUD-E2E', 19990, 12000, 3, minimum='2', warranty=6, serial=True)
    check(stock('DET-E2E') == 20 and stock('GAL-E2E') == 10 and stock('AUD-E2E') == 3, '📦 Crea productos de aseo, comestibles y electrónica con su stock inicial')
    check(sql(f"select track_expiry::text || '|' || (select expires_on::text || ':' || lot_code from product_lots l where l.product_id = p.id) from products p where sku = 'GAL-E2E'") == f'true|{d10}:L1',
          '📅 El comestible controla vencimiento por lote (fecha y lote guardados)')
    check(sql("select warranty_months::text || '|' || requires_serial from products where sku = 'AUD-E2E'") == '6|true', '🔌 La electrónica guarda garantía (6 meses) y exige N° de serie')

    # ================= 2. Compra a proveedor =================
    go(t, f'{BASE}/app/tienda/compras')
    gal = sql("select id from products where sku = 'GAL-E2E'")
    t.fill('input[name=supplier]', 'Distribuidora Central E2E'); t.fill('input[name=document_number]', 'F-777')
    line = t.locator('[data-testid=lineas-compra] > div').first
    line.locator('select[name=product]').select_option(gal); line.locator('input[name=qty]').fill('12'); line.locator('input[name=cost]').fill('760')
    line.locator('input[name=expires]').fill(d60)
    f = t.locator('form:has([data-testid=lineas-compra])'); f.locator('button:has-text("Registrar compra")').click(); form_status(f)
    check(stock('GAL-E2E') == 22, '📥 La compra suma stock (10 + 12 = 22)')
    check(sql("select count(*) from product_lots where product_id = (select id from products where sku = 'GAL-E2E') and qty_remaining > 0") == '2', '📅 Queda un lote nuevo con su vencimiento')
    check(sql(f"select amount::int from expenses where organization_id = '{ORG}' and category = 'mercaderia'") == '9120', '💸 Registra el gasto de mercadería (12 × 760 = 9.120) en Finanzas')
    check(sql("select cost from products where sku = 'GAL-E2E'") == '732.73', '🧮 Actualiza el costo promedio ponderado ((10×700 + 12×760) / 22)')

    # ================= 3. Caja =================
    sc = b.new_context(viewport={'width': 1366, 'height': 900}); s = login(sc, 'secretaria.a@demo.sematec.test')
    go(s, f'{BASE}/app/tienda/caja'); s.wait_for_selector('[data-testid=caja-buscar]')
    s.fill('[data-testid=caja-buscar]', '7800000000017'); s.keyboard.press('Enter')
    check('Detergente' in s.locator('[data-testid=carrito]').inner_text(), '🔎 El lector de código de barras agrega el producto (código + Enter)')
    s.locator('[data-testid=caja-producto]:has-text("Galletas")').click(); s.locator('[data-testid=caja-producto]:has-text("Galletas")').click()
    s.locator('[data-testid=caja-producto]:has-text("Audífonos")').click()
    check(s.locator('[data-testid=cobrar]').is_disabled(), '🔌 No deja cobrar la electrónica sin N° de serie')
    s.fill('[data-testid=serie]', 'SN-ABC-123')
    check('27.560' in s.locator('[data-testid=caja-total]').inner_text(), '🧾 Total correcto (4.990 + 2 × 1.290 + 19.990 = 27.560)')
    s.fill('[data-testid=caja-efectivo]', '30000')
    check('2.440' in s.locator('[data-testid=caja-vuelto]').inner_text(), '💵 Calcula el vuelto (30.000 − 27.560 = 2.440)')
    s.click('[data-testid=cobrar]'); s.wait_for_selector('[data-testid=venta-lista]', timeout=20000)
    check('Vuelto' in s.locator('[data-testid=venta-lista]').inner_text(), '✅ Venta registrada, muestra el N° y el vuelto')
    sale = sql(f"select id from sales where organization_id = '{ORG}' order by created_at desc limit 1")
    check(stock('DET-E2E') == 19 and stock('GAL-E2E') == 20 and stock('AUD-E2E') == 2, '📉 Descuenta el stock de lo vendido')
    check(sql("select qty_remaining from product_lots where product_id = (select id from products where sku = 'GAL-E2E') and lot_code = 'L1'") == '8.000',
          '📅 Vende primero el lote que vence antes (FEFO)')
    check(sql(f"select total::int || '|' || tax::int || '|' || change_given::int from sales where id = '{sale}'") == '27560|4400|2440', '🧮 Guarda total, IVA incluido (4.400) y vuelto')
    s.click('[data-testid=nueva-venta]')
    for _ in range(2): s.locator('[data-testid=caja-producto]:has-text("Audífonos")').click()
    aud = s.locator('[data-testid=caja-producto]:has-text("Audífonos")')
    s.fill('[data-testid=caja-buscar]', 'AUD-E2E'); s.keyboard.press('Enter')
    check(aud.is_disabled() and 'Agotado' in aud.inner_text() and 'Sin stock suficiente' in s.locator('[data-testid=caja-mensaje]').inner_text(),
          '🚫 No permite vender más de lo que hay en stock (se marca «Agotado»)')

    go(s, f'{BASE}/app/tienda/ventas/{sale}')
    txt = s.locator('[data-testid=comprobante-venta]').inner_text()
    check('SN-ABC-123' in txt and 'Garantía hasta' in txt and 'IVA' in txt and 'Vuelto' in txt, '🧾 Comprobante con N° de serie, garantía, IVA y vuelto')
    r = sc.request.get(f'{BASE}/app/tienda/ventas/{sale}/pdf')
    check(r.status == 200 and r.body()[:4] == b'%PDF', '🖨 Ticket en PDF (80 mm) para imprimir o enviar')
    check(s.locator('text=Anular venta').count() == 0, '🔒 La secretaria (caja) no puede anular ventas')

    # Venta con tarjeta y anulación por tesorería
    go(s, f'{BASE}/app/tienda/caja'); s.fill('[data-testid=caja-buscar]', 'DET-E2E'); s.keyboard.press('Enter')
    s.locator('button:has-text("Tarjeta")').click(); s.click('[data-testid=cobrar]'); s.wait_for_selector('[data-testid=venta-lista]')
    sale2 = sql(f"select id from sales where organization_id = '{ORG}' order by created_at desc limit 1")
    check(stock('DET-E2E') == 18, 'Venta con tarjeta')
    go(t, f'{BASE}/app/tienda/ventas/{sale2}')
    a = t.locator('form:has(button:has-text("Anular"))'); a.locator('input[name=reason]').fill('Cliente se arrepintió'); a.locator('button').click()
    for _ in range(40):
        if sql(f"select status from sales where id = '{sale2}'") == 'anulada': break
        time.sleep(0.5)
    check(stock('DET-E2E') == 19 and sql(f"select status from sales where id = '{sale2}'") == 'anulada', '↩ Tesorería anula la venta y el producto vuelve al stock')

    # ================= 4. Tienda web =================
    wc = b.new_context(viewport={'width': 1366, 'height': 900}); w = wc.new_page()
    go(w, f'{BASE}/tienda'); w.wait_for_selector('[data-testid=catalogo]')
    check(w.locator('[data-testid=producto-web]').count() == 3, '🌐 La tienda web muestra los productos publicados')
    w.locator('[data-testid=producto-web]:has-text("Galletas") [data-testid=agregar]').click()
    w.locator('[data-testid=producto-web]:has-text("Galletas") button[aria-label="Agregar uno"]').click()
    w.locator('[data-testid=producto-web]:has-text("Detergente") [data-testid=agregar]').click()
    w.click('[data-testid=ver-carro]'); w.click('[data-testid=continuar]')
    fo = w.locator('[data-testid=form-pedido]')
    fo.locator('input[name=name]').fill('Cliente Web E2E'); fo.locator('input[name=email]').fill('cliente.web@demo.sematec.test'); fo.locator('input[name=phone]').fill('+56911112222')
    fo.locator('input[name=doc_number]').fill('11.111.111-1'); fo.locator('input[name=payment][value=bank_transfer]').check()
    fo.locator('[data-testid=confirmar-pedido]').click(); w.wait_for_url(re.compile('/tienda/pedido/'), timeout=20000)
    seg = w.locator('[data-testid=seguimiento]').inner_text()
    check('Pedido N°' in seg and 'transferencia' in seg and '7.570' in seg, '🛍 El cliente hace el pedido (sin cuenta) y ve su seguimiento con instrucciones de pago')
    web = sql(f"select id from sales where organization_id = '{ORG}' and channel = 'web' order by created_at desc limit 1")
    check(stock('GAL-E2E') == 18 and stock('DET-E2E') == 18, '📦 El pedido web reserva el stock')
    track = w.url.rsplit('/', 1)[-1]
    # El precio no se puede alterar: el servidor usa el precio de la base de datos
    r = wc.request.post(f'{BASE}/api/tienda/pedido', data=json.dumps({'items': [{'product': gal, 'qty': 999, 'price': 1}], 'name': 'Truco', 'email': 'truco@x.cl', 'delivery': 'retiro', 'payment': 'cash'}), headers={'Content-Type': 'application/json'})
    check(r.status == 400 and 'Stock insuficiente' in r.json().get('error', ''), '🔒 La web valida stock en el servidor (no se puede pedir más de lo disponible)')

    # Gestión del pedido por el personal
    go(s, f'{BASE}/app/tienda/pedidos'); card = s.locator(f'[data-testid=pedidos] section:has-text("Cliente Web E2E")')
    card.locator('button:has-text("Registrar pago")').click(); time.sleep(2)
    go(s, f'{BASE}/app/tienda/pedidos'); s.locator('[data-testid=pedidos] section:has-text("Cliente Web E2E") button:has-text("Listo")').click(); time.sleep(2)
    go(s, f'{BASE}/app/tienda/pedidos'); s.locator('[data-testid=pedidos] section:has-text("Cliente Web E2E") button:has-text("Entregado")').click(); time.sleep(2)
    check(sql(f"select status || '|' || payment_method from sales where id = '{web}'") == 'entregada|bank_transfer', '🚚 El personal registra el pago, marca listo y entregado')
    go(w, f'{BASE}/tienda/pedido/{track}')
    check('✓ Entregado' in w.locator('[data-testid=estado-pedido]').inner_text(), '👀 El cliente ve el avance de su pedido')
    r = wc.request.get(f'{BASE}/tienda/pedido/{track}/pdf')
    check(r.status == 200 and r.body()[:4] == b'%PDF', '⬇ El cliente descarga su comprobante')

    # Pago en línea (simulador de Webpay)
    go(w, f'{BASE}/tienda'); w.locator('[data-testid=producto-web]:has-text("Audífonos") [data-testid=agregar]').click()
    w.click('[data-testid=ver-carro]'); w.click('[data-testid=continuar]'); fo = w.locator('[data-testid=form-pedido]')
    fo.locator('input[name=name]').fill('Comprador Online E2E'); fo.locator('input[name=email]').fill('online.tienda@demo.sematec.test')
    fo.locator('input[name=payment][value="online:webpay"]').check(); fo.locator('[data-testid=confirmar-pedido]').click()
    w.wait_for_selector('#provider', timeout=20000); w.click('#approve')
    w.wait_for_url(re.compile(r'/pago/resultado/'), timeout=30000)
    try: w.wait_for_selector('text=Estamos preparando tu pedido', timeout=20000)
    except Exception: pass
    onl = sql(f"select status || '|' || payment_method from sales where organization_id = '{ORG}' and customer_email = 'online.tienda@demo.sematec.test'")
    check(onl == 'pagada|payment_gateway', f'💳 Pago en línea aprobado: el pedido queda pagado ({onl})')

    # ================= 5. Resumen, alertas, finanzas y búsqueda =================
    go(t, f'{BASE}/app/tienda')
    check(t.locator('[data-testid=ventas-hoy]').inner_text() != '$0', f'📊 Resumen: ventas de hoy ({t.locator("[data-testid=ventas-hoy]").inner_text()})')
    check('Audífonos' in t.locator('[data-testid=stock-bajo]').inner_text(), '⚠ Alerta de stock bajo (audífonos)')
    check('Galletas' in t.locator('[data-testid=por-vencer]').inner_text(), '⚠ Alerta de productos por vencer (lote L1)')
    go(t, f'{BASE}/app/finanzas/balance')
    check('Tienda' in t.locator('[data-testid=kpi-tienda]').inner_text(), '💰 Las ventas de la tienda suman a los ingresos del balance financiero')
    t.keyboard.press('Control+k'); t.fill('[data-testid=buscar-texto]', 'Galletas')
    t.wait_for_selector('[data-testid=buscar-resultados] >> text=Producto', timeout=10000); check(True, '🔍 La búsqueda global encuentra productos')
    t.keyboard.press('Escape')
    r = tc.request.get(f'{BASE}/app/tienda/productos/csv')
    check(r.status == 200 and 'Galletas de avena E2E' in r.text(), '⬇ Inventario descargable para Excel')
    go(t, f'{BASE}/app/tienda/productos/{gal}')
    check(t.locator('[data-testid=movimientos] tbody tr').count() >= 4, '📜 Historial de movimientos del producto (compra, ventas, pedido web)')
    e = b.new_context(); ep = login(e, 'estudiante1.a@demo.sematec.test')
    go(ep, f'{BASE}/app/tienda/caja')
    check('/app/tienda/caja' not in ep.url, '🔒 Un estudiante no puede entrar a la caja')
    b.close()

print(f"\n{sum(1 for ok, _ in results if ok)}/{len(results)} verificaciones OK")
