"""
Prueba en tamaño de celular (iPhone): instalación desde el navegador sobre un proyecto
Supabase vacío, luego uso de la plataforma con usuarios de demostración y compra con Webpay.
"""
import os, re, sys
sys.path.insert(0, os.path.dirname(__file__))
from e2e import BASE, CHROME, sql, check, shot, status_msg, go, results
from e2e_web import buy
from playwright.sync_api import sync_playwright

TOKEN = os.environ.get('SETUP_TOKEN', 'prueba-instalador-123')

def main():
    with sync_playwright() as pw:
        b = pw.chromium.launch(executable_path=CHROME, headless=True, args=['--no-sandbox'])
        phone = pw.devices['iPhone 13']
        mk = lambda: b.new_context(**{k: v for k, v in phone.items() if k != 'default_browser_type'})
        check(sql("select to_regclass('public.organizations') is null") == 't', 'Base de datos vacía (proyecto Supabase recién creado)')

        c = mk(); p = c.new_page(); go(p, BASE + '/instalar'); shot(p, 'cel_01_instalador')
        p.fill('input[name=token]', 'clave-incorrecta'); p.click('button:has-text("Instalar")')
        p.wait_for_selector('text=Clave de instalación incorrecta', timeout=20000); check(True, 'Instalador rechaza clave incorrecta')
        check(sql("select to_regclass('public.organizations') is null") == 't', 'Con clave incorrecta no se instala nada')
        p.fill('input[name=token]', TOKEN); p.click('button:has-text("Instalar")')
        p.wait_for_selector('text=Instalación completa', timeout=90000)
        check(True, 'Instalación desde el celular completada'); shot(p, 'cel_02_instalado')
        check(sql("select count(*) from supabase_migrations.schema_migrations") == '16', '16 migraciones registradas')
        check(sql("select count(*) from public.permissions") == '133', 'Permisos y roles creados')
        c.close()

        # Ingreso con usuario demo creado por SQL (verifica compatibilidad con Supabase Auth)
        c = mk(); p = c.new_page(); go(p, BASE + '/login'); shot(p, 'cel_03_login')
        p.fill('input[name=email]', 'estudiante1.a@demo.sematec.test'); p.fill('input[name=password]', 'Sematec-Demo-2026'); p.click('button[type=submit]')
        p.wait_for_url(re.compile('/app'), timeout=20000); p.wait_for_load_state('networkidle')
        check(True, 'Usuario de demostración inicia sesión'); shot(p, 'cel_04_inicio_estudiante')
        p.click('button:has-text("Menú")'); p.wait_for_selector('nav a:has-text("Mi portal")')
        shot(p, 'cel_05_menu_abierto'); p.click('nav a:has-text("Mi portal")')
        p.wait_for_url(re.compile('/app/mi')); p.wait_for_load_state('networkidle')
        check(p.locator('text=Estado de cuenta').count() >= 1, 'Portal del estudiante en el celular'); shot(p, 'cel_06_portal')
        c.close()

        # Sitio público y compra con Webpay en el celular
        c = mk(); p = c.new_page(); go(p, BASE + '/'); shot(p, 'cel_07_sitio')
        check(p.locator('text=$89.000').count() >= 1, 'Sitio público con precios en el celular'); c.close()
        c, p = buy(b, 'webpay', 'compra.celular@demo.sematec.test', 'CEL-0001')
        check(p.locator('text=¡Pago aprobado!').count() == 1, 'Compra con Webpay completada'); c.close()

        # Ingreso seguro rechaza la reinstalación? (instalador idempotente)
        c = mk(); p = c.new_page(); go(p, BASE + '/instalar')
        check(p.locator('text=ya está instalada').count() == 1, 'El instalador detecta que la base ya está instalada'); c.close()
        b.close()
    ok = sum(1 for r in results if r[0]); print(f'\nVerificaciones en celular: {ok}/{len(results)}')

if __name__ == '__main__':
    try: main()
    except Exception as e:
        print('ERROR:', e); ok = sum(1 for r in results if r[0]); print(f'\nVerificaciones en celular: {ok}/{len(results)} (interrumpido)'); sys.exit(1)
