"""
Plataforma más amplia y pro:
 · matrícula + arancel en cuotas desde el sitio (plan «solo matrícula» y plan «todo»), con pago real (servidor de pruebas)
 · matrícula interna con precio de matrícula y «usar los precios del curso»
 · idiomas del sitio (es / en / fr / pt) y menú para celulares
 · colores de las tarjetas: institución y preferencia personal
"""
import os, re, sys
sys.path.insert(0, os.path.dirname(__file__))
from e2e import BASE, CHROME, sql, check, shot, login, go, status_msg, results
from playwright.sync_api import sync_playwright

SLUG = 'sql-desde-cero'

def checkout(b, email, plan, doc):
    c = b.new_context(viewport={'width': 1366, 'height': 900}); p = c.new_page()
    go(p, f'{BASE}/cursos/{SLUG}/inscripcion')
    p.fill('input[name=name]', f'Alumno {plan.title()}'); p.fill('input[name=email]', email); p.fill('input[name=doc_number]', doc)
    p.check(f'[data-testid=plan-{plan}]')
    p.check('input[name=provider][value=webpay]'); p.check('input[name=consent]')
    p.click('button:has-text("Ir a pagar")')
    p.wait_for_selector('#provider', timeout=20000); p.click('#approve')
    p.wait_for_url(re.compile(r'/pago/resultado/'), timeout=30000); p.wait_for_load_state('networkidle')
    p.wait_for_selector('text=¡Pago aprobado!', timeout=20000)
    return c, p

def charges(email):
    return sql(f"""select string_agg(c.concept||':'||c.gross_amount::int||':'||c.status||':'||(select count(*) from installments i where i.charge_id=c.id), ',' order by c.concept)
                   from charges c join students s on s.id=c.student_id where s.email='{email}'""")

def main():
    with sync_playwright() as pw:
        b = pw.chromium.launch(executable_path=CHROME, headless=True, args=['--no-sandbox'])
        new = lambda **k: b.new_context(viewport=k.get('viewport', {'width': 1366, 'height': 900}))
        off = sql(f"select id from catalog_offerings where slug='{SLUG}'")
        price = int(float(sql(f"select (public.offering_breakdown('{off}')->>'course_price')")))

        # 1. El propietario define matrícula y cuotas en el editor del curso
        oc = new(); o = login(oc, 'propietario.a@demo.sematec.test', mfa=True)
        go(o, f'{BASE}/app/sitio/cursos/{off}')
        o.fill('input[name=enrollment_fee]', '30000'); o.fill('input[name=installments_count]', '3')
        o.click('button:has-text("Guardar cambios")')
        check('actualizado' in status_msg(o), 'Editor del curso guarda matrícula y cuotas')
        check(sql(f"select enrollment_fee::int||'|'||installments_count from catalog_offerings where id='{off}'") == '30000|3', 'Matrícula 30.000 y arancel en 3 cuotas guardados')

        # 2. El sitio muestra el desglose
        c = new(); p = c.new_page(); go(p, f'{BASE}/cursos/{SLUG}')
        d = p.locator('[data-testid=desglose]').inner_text()
        check('Matrícula' in d and '30.000' in d and f'{price + 30000:,}'.replace(',', '.') in d, f'Detalle del curso: matrícula + arancel = total ({d.splitlines()[-1] if d else ""})')
        check(p.locator('[data-testid=precio-matricula]').count() >= 1, 'El precio indica «+ Matrícula»')
        go(p, f'{BASE}/cursos'); check('Matrícula' in p.locator('[data-testid=tarjeta-curso]', has_text='SQL').first.inner_text(), 'La tarjeta del catálogo muestra la matrícula')
        go(p, f'{BASE}/cursos/{SLUG}/inscripcion')
        check(p.locator('[data-testid=plan-pago]').count() == 1, 'Inscripción: elegir pagar todo o solo la matrícula')
        shot(p, 'pro_01_inscripcion_planes'); c.close()

        # 3. Plan «solo matrícula»: paga 30.000 y el arancel queda en 3 cuotas pendientes
        email = 'plan.matricula@demo.sematec.test'
        c, p = checkout(b, email, 'matricula', '15.151.515-0')
        check(p.locator('[data-testid=aviso-cuotas]').count() == 1, 'Resultado del pago explica las cuotas pendientes del arancel')
        shot(p, 'pro_02_pago_matricula')
        row = sql(f"select plan||'|'||amount::int||'|'||status||'|'||(enrollment_id is not null) from checkout_orders where buyer_email='{email}'")
        check(row == 'matricula|30000|paid|true', f'Pedido: solo la matrícula, pagado y matriculado ({row})')
        ch = charges(email)
        check(ch == f'enrollment_fee:30000:paid:1,tuition:{price}:pending:3', f'Cuenta del alumno: matrícula pagada + arancel en 3 cuotas pendientes ({ch})')
        c.close()

        # 4. Plan «todo»: paga matrícula + arancel
        email2 = 'plan.total@demo.sematec.test'
        c, p = checkout(b, email2, 'total', '16.161.616-8')
        row = sql(f"select plan||'|'||amount::int from checkout_orders where buyer_email='{email2}'")
        check(row == f'total|{price + 30000}', f'Pedido: matrícula + arancel en un pago ({row})')
        ch = charges(email2)
        check(ch == f'enrollment_fee:30000:paid:1,tuition:{price}:paid:1', f'Matrícula y arancel pagados ({ch})')
        alloc = sql(f"select sum(pa.amount)::int from payment_allocations pa join payments y on y.id=pa.payment_id join students s on s.id=y.student_id where s.email='{email2}'")
        check(alloc == str(price + 30000), 'El pago quedó imputado a la matrícula y al arancel')
        c.close()

        # 5. Idiomas del sitio
        c = new(); p = c.new_page(); go(p, BASE + '/')
        check(p.locator('[data-testid=pasos-inscripcion]').count() == 1 and p.locator('[data-testid=faq]').count() == 1, 'Portada nueva: pasos de inscripción y preguntas frecuentes')
        shot(p, 'pro_03_portada')
        for lang, home_txt, nav_txt, btn in [('en', 'How to enroll', 'Courses', 'Enroll and pay'), ('fr', 'Comment s’inscrire', 'Formations', 'S’inscrire et payer'), ('pt', 'Como se inscrever', 'Cursos', 'Inscrever-me e pagar')]:
            p.click('[data-testid=idioma-sitio]'); p.click(f'[data-testid=idioma-{lang}]')
            p.wait_for_selector(f'text={home_txt}', timeout=20000)
            check(p.locator('header').get_by_text(nav_txt, exact=True).count() >= 1, f'Sitio en {lang}: portada y menú traducidos')
            go(p, f'{BASE}/cursos/{SLUG}'); check(p.locator(f'text={btn}').count() == 1, f'Sitio en {lang}: detalle del curso traducido')
            if lang == 'en':
                go(p, f'{BASE}/cursos/{SLUG}/inscripcion')
                check(p.locator('text=Pay only the enrollment fee').count() == 1 and p.locator('text=Full name').count() == 1, 'Inscripción en inglés: planes y formulario traducidos')
                shot(p, 'pro_04_ingles')
            go(p, BASE + '/')
        p.click('[data-testid=idioma-sitio]'); p.click('[data-testid=idioma-es]'); p.wait_for_selector('text=Cómo inscribirte', timeout=20000)
        check(True, 'Vuelve a español')
        c.close()

        # 6. Menú para celulares
        c = new(viewport={'width': 390, 'height': 844}); p = c.new_page(); go(p, BASE + '/')
        p.click('[data-testid=menu-movil]')
        p.locator('nav a', has_text='Estado de solicitud').last.click(); p.wait_for_url(re.compile(r'/estado'), timeout=20000)
        check('/estado' in p.url, 'Menú del celular abre y navega'); shot(p, 'pro_05_movil'); c.close()

        # 7. Colores de las tarjetas: institución
        go(o, f'{BASE}/app/configuracion?t=institucion')
        box = o.locator('#tarjetas-institucion')
        box.locator('[data-testid=tarjetas-estilo-degradado]').check()
        box.locator('button[aria-label=Violeta]').click()
        box.locator('button:has-text("Guardar para toda la institución")').click()
        check('toda la institución' in box.locator('[role=status]').inner_text(), 'Propietario guarda el estilo de tarjetas de la institución')
        go(o, f'{BASE}/app')
        check(o.locator('[data-cards]').first.get_attribute('data-cards') == 'degradado', 'Panel con tarjetas en degradado para toda la institución')
        bg = o.locator('.stat-card').first.evaluate('e => getComputedStyle(e).backgroundImage')
        check('gradient' in bg, 'Las tarjetas de cifras se ven con degradado de color')
        shot(o, 'pro_06_tarjetas_institucion')
        # personal
        dc = new(); d = login(dc, 'director.a@demo.sematec.test', mfa=True)
        check(d.locator('[data-cards]').first.get_attribute('data-cards') == 'degradado', 'Otro usuario ve el estilo de la institución')
        go(d, f'{BASE}/app/configuracion')
        mine = d.locator('#tarjetas')
        mine.locator('[data-testid=tarjetas-heredar]').uncheck()
        mine.locator('[data-testid=tarjetas-estilo-multicolor]').check()
        mine.locator('button:has-text("Guardar colores")').click()
        check('solo le afectan a usted' in mine.locator('[role=status]').inner_text(), 'Usuario guarda su propio estilo de tarjetas')
        go(d, f'{BASE}/app'); check(d.locator('[data-cards]').first.get_attribute('data-cards') == 'multicolor', 'Su panel usa su estilo personal (multicolor)')
        shot(d, 'pro_07_tarjetas_personal')
        go(o, f'{BASE}/app'); check(o.locator('[data-cards]').first.get_attribute('data-cards') == 'degradado', 'El estilo personal no cambia a los demás')
        go(d, f'{BASE}/app/configuracion'); d.locator('#tarjetas [data-testid=tarjetas-heredar]').check()
        d.locator('#tarjetas button:has-text("Guardar colores")').click()
        check('colores de la institución' in d.locator('#tarjetas [role=status]').inner_text(), 'Puede volver a los colores de la institución')
        go(d, f'{BASE}/app'); check(d.locator('[data-cards]').first.get_attribute('data-cards') == 'degradado', 'Vuelve al estilo de la institución')
        dc.close()

        # 8. Matrícula interna con precio de matrícula
        org = sql(f"select organization_id from catalog_offerings where id='{off}'")
        prog, per = sql(f"select program_id||'|'||period_id from catalog_offerings where id='{off}'").split('|')
        stu = sql(f"""insert into students (organization_id, campus_id, student_code, first_names, last_names, id_document_country, id_document_type, id_document_number, email)
                      select '{org}', (select id from campuses where organization_id='{org}' order by created_at limit 1), 'PRO-0001', 'Matías', 'Interno',
                             'CL', 'RUN', '17171717-5', 'matricula.interna@demo.sematec.test' returning id""").splitlines()[0]
        go(o, f'{BASE}/app/matriculas')
        o.select_option('select[name=student_id]', stu)
        o.select_option('[data-testid=usar-precios-curso]', off)
        check(o.input_value('input[name=enrollment_fee]') == '30000' and o.input_value('input[name=installments]') == '3', '«Usar los precios del curso» completa matrícula, arancel y cuotas')
        check(o.input_value('select[name=program_id]') == prog, '… y el programa del curso')
        o.fill('input[name=first_due]', '2026-12-05')
        o.click('button:has-text("Matricular")')
        msg = status_msg(o)
        check('Cobro de matrícula generado' in msg and 'Arancel y cuotas generados' in msg, f'Matrícula interna con cobro de matrícula y arancel ({msg[:90]})')
        ch = sql(f"""select string_agg(concept||':'||gross_amount::int||':'||(select count(*) from installments i where i.charge_id=c.id), ',' order by concept)
                     from charges c where c.student_id='{stu}' and c.enrollment_id=(select id from enrollments where student_id='{stu}' and program_id='{prog}' and period_id='{per}')""")
        check(ch == f'enrollment_fee:30000:1,tuition:{price}:3', f'Cargos internos: matrícula en 1 cuota + arancel en 3 ({ch})')
        shot(o, 'pro_08_matricula_interna')
        oc.close(); b.close()

if __name__ == '__main__':
    try: main()
    finally:
        ok = sum(1 for r in results if r[0]); print(f'\n{ok}/{len(results)} verificaciones OK')
