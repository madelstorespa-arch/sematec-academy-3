"""
Recuperar contraseña con cualquier correo registrado de una cuenta activa:
correo del perfil, correo de la ficha (estudiante / profesor / funcionario), RUT, mayúsculas y espacios;
cuentas suspendidas y correos desconocidos no reciben nada (misma respuesta, sin revelar datos).
"""
import email, glob, os, re, sys, time
from email import policy
sys.path.insert(0, os.path.dirname(__file__))
from e2e import BASE, CHROME, sql, check, go, status_msg, results
from playwright.sync_api import sync_playwright

def until(fn, timeout=15):
    end = time.time() + timeout
    while time.time() < end:
        if fn(): return True
        time.sleep(0.4)
    return False

def mails(addr):
    out = []
    for f in sorted(glob.glob('/tmp/mails/*.eml')):
        raw = open(f, 'rb').read(); first, rest = raw.split(b'\r\n', 1)
        if addr.encode() not in first: continue
        m = email.message_from_bytes(rest, policy=policy.default); b = m.get_body(preferencelist=('plain',))
        out.append(b.get_content() if b else '')
    return out

def ask(b, ident):
    c = b.new_context(); p = c.new_page(); go(p, f'{BASE}/recuperar')
    p.fill('input[name=email]', ident); p.click('button:has-text("Enviar enlace")'); m = status_msg(p); c.close(); return m

def main():
    os.makedirs('/tmp/mails', exist_ok=True)
    for f in glob.glob('/tmp/mails/*.eml'): os.remove(f)
    # Fichas con correos distintos al de inicio de sesión
    sql("update students set email='ana.ficha@correo-personal.cl', id_document_number='11.111.111-1' where email='estudiante3.a@demo.sematec.test'")
    sql("update teachers set email='profe.personal@correo-personal.cl' where user_id=(select id from profiles where email='profesor2.a@demo.sematec.test')")
    sql("update profiles set status='suspended', status_reason='Prueba' where email='estudiante2.a@demo.sematec.test'")
    with sync_playwright() as pw:
        b = pw.chromium.launch(executable_path=CHROME, headless=True, args=['--no-sandbox'])
        generic = ask(b, 'ana.ficha@correo-personal.cl')
        check(until(lambda: mails('ana.ficha@correo-personal.cl')), 'Correo de la ficha del estudiante: recibe el enlace')
        body = mails('ana.ficha@correo-personal.cl')[-1]
        check('estudiante3.a@demo.sematec.test' in body, 'El correo le recuerda su usuario para entrar')
        link = re.search(r'(https?://\S+/auth/confirm\?\S+)', body).group(1)
        c = b.new_context(); p = c.new_page(); go(p, re.sub(r'^https?://[^/]+', BASE, link)); p.wait_for_url(re.compile(r'/cambiar-clave'), timeout=20000)
        p.fill('input[name=password]', 'FichaPersonal2026x'); p.fill('input[name=confirm]', 'FichaPersonal2026x'); p.click('button:has-text("Guardar contraseña")'); status_msg(p); c.close()
        c = b.new_context(); p = c.new_page(); go(p, f'{BASE}/login'); p.fill('input[name=email]', 'estudiante3.a@demo.sematec.test'); p.fill('input[name=password]', 'FichaPersonal2026x'); p.click('button[type=submit]')
        p.wait_for_url(re.compile(r'/app'), timeout=20000); c.close()
        check(True, 'Con ese enlace crea su contraseña y entra con su usuario')

        ask(b, '  PROFE.Personal@Correo-Personal.cl ')
        check(until(lambda: mails('profe.personal@correo-personal.cl')), 'Correo de la ficha del profesor (con mayúsculas y espacios): recibe el enlace')
        ask(b, '11111111-1')
        check(until(lambda: mails('estudiante3.a@demo.sematec.test')), 'Por RUT (sin puntos): el enlace llega al correo de la cuenta')
        ask(b, 'profesor1.a@demo.sematec.test')
        check(until(lambda: mails('profesor1.a@demo.sematec.test')), 'Correo del perfil: recibe el enlace')
        m2 = ask(b, 'estudiante2.a@demo.sematec.test'); time.sleep(3)
        check(not mails('estudiante2.a@demo.sematec.test') and m2 == generic, 'Cuenta suspendida: no recibe nada y la respuesta no lo revela')
        m3 = ask(b, 'nadie@no-existe.cl'); time.sleep(2)
        check(not mails('nadie@no-existe.cl') and m3 == generic, 'Correo no registrado: misma respuesta, sin envío')
        b.close()
    sql("update profiles set status='active', status_reason=null where email='estudiante2.a@demo.sematec.test'")
    ok = sum(1 for r in results if r[0]); print(f'\n{ok}/{len(results)} verificaciones OK')

if __name__ == '__main__':
    main()
