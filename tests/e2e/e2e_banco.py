"""«Paga con tu banco» (Fintoc) de punta a punta contra tests/e2e/payment-mock.mjs."""
import re, sys, os
sys.path.insert(0, os.path.dirname(__file__))
from e2e import BASE, CHROME, sql, check, shot, go, results
from playwright.sync_api import sync_playwright

def pay(b, email, doc, bank, button, mobile=False):
    c = b.new_context(viewport={'width': 390, 'height': 844} if mobile else {'width': 1366, 'height': 900}, is_mobile=mobile)
    p = c.new_page(); go(p, f'{BASE}/cursos/sql-desde-cero/inscripcion')
    p.fill('input[name=name]', 'Pagador Banco'); p.fill('input[name=email]', email); p.fill('input[name=doc_number]', '17.171.717-5')
    p.check('input[name=provider][value=fintoc]')
    check(p.locator('input[name=bank]').count() == 21, 'Se muestran los 21 bancos e instituciones de Chile')
    p.locator(f'label:has(input[value={bank}])').click(); p.check('input[name=consent]')
    shot(p, f'banco_{bank}')
    p.click('button:has-text("Ir a pagar")'); p.wait_for_selector('#provider', timeout=20000)
    check(p.locator('#bank').inner_text() == bank, f'Entra directo al banco elegido ({bank})')
    p.click(button); p.wait_for_url(re.compile(r'/pago/resultado/'), timeout=30000); p.wait_for_load_state('networkidle')
    return c, p

with sync_playwright() as pw:
    b = pw.chromium.launch(executable_path=CHROME, headless=True, args=['--no-sandbox'])
    c, p = pay(b, 'banco.ok@demo.sematec.test', 'BANCO-1', 'cl_banco_estado', '#approve', mobile=True)
    p.wait_for_selector('text=¡Pago aprobado!', timeout=15000)
    row = sql("select status||'|'||provider||'|'||(enrollment_id is not null)||'|'||(payment_id is not null) from checkout_orders where buyer_email='banco.ok@demo.sematec.test'")
    check(row == 'paid|fintoc|true|true', f'Transferencia aprobada: pedido pagado, matrícula y pago contable ({row})'); shot(p, 'banco_aprobado'); c.close()
    c, p = pay(b, 'banco.no@demo.sematec.test', 'BANCO-2', 'cl_banco_bci', '#reject')
    check(p.locator('text=¡Pago aprobado!').count() == 0, 'Transferencia rechazada no se muestra como pagada')
    row = sql("select status from checkout_orders where buyer_email='banco.no@demo.sematec.test'")
    check(row in ('failed', 'cancelled'), f'Pedido rechazado queda sin pagar ({row})'); c.close()
    b.close()
print(f"\n{sum(1 for ok, _ in results if ok)}/{len(results)} pruebas OK")
