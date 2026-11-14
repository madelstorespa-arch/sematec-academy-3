"""
«Crear cuenta» con un correo que ya es la cuenta de otra ficha: mensaje claro y opción de mover la cuenta.
"""
import os, re, sys
sys.path.insert(0, os.path.dirname(__file__))
from e2e import BASE, CHROME, sql, check, go, login, status_msg, results
from playwright.sync_api import sync_playwright

ORG = '0a000000-0000-4000-8000-000000000001'

def main():
    dup = sql(f"insert into students (organization_id, campus_id, student_code, first_names, last_names, email) values ('{ORG}', '0a000000-0000-4000-8000-0000000000c1', 'DUP-E2E', 'Estudiante', 'Uno Duplicado', 'estudiante1.a@demo.sematec.test') returning id").split('\n')[0]
    with sync_playwright() as pw:
        b = pw.chromium.launch(executable_path=CHROME, headless=True, args=['--no-sandbox'])
        c = b.new_context(); p = login(c, 'secretaria.a@demo.sematec.test'); go(p, f'{BASE}/app/estudiantes/{dup}')
        form = p.locator('form:has(button:has-text("Crear cuenta"))').last
        form.locator('input[name=password]').fill('Duplicada2026x'); form.locator('button:has-text("Crear cuenta")').click()
        m = status_msg(p)
        check('ya es la cuenta de otra ficha' in m and 'Mover la cuenta' in m and 'repetido' not in m, f'Correo de otra ficha: explica el motivo ({m[:110]})')
        check(sql(f"select user_id is null from students where id='{dup}'") == 't', 'No cambia nada sin confirmar')
        go(p, f'{BASE}/app/estudiantes/{dup}')
        form = p.locator('form:has(button:has-text("Crear cuenta"))').last
        form.locator('input[name=password]').fill('Duplicada2026x'); form.locator('input[name=move]').check(); form.locator('button:has-text("Crear cuenta")').click()
        m = status_msg(p)
        check('movida a esta ficha' in m and 'sigue siendo la de antes' in m, f'Mover la cuenta a esta ficha ({m[:110]})')
        check(sql(f"select user_id is not null from students where id='{dup}'") == 't'
              and sql("select count(*) from students where email='estudiante1.a@demo.sematec.test' and user_id is not null") == '1', 'La cuenta queda solo en la ficha elegida')
        c.close(); b.close()
    ok = sum(1 for r in results if r[0]); print(f'\n{ok}/{len(results)} verificaciones OK')

if __name__ == '__main__':
    main()
