"""
Aula: estudiantes que no ven sus cursos y evaluaciones → informe y reparación.
- Ficha sin cuenta vinculada, cuenta sin acceso a la institución, matriculados sin cursos.
- «Reparar todo» vincula, da acceso e inscribe en las asignaturas de su nivel (respeta el cupo).
- Al iniciar sesión, la ficha con el mismo correo se vincula sola.
- Exámenes en borrador aparecen en el informe y se publican desde ahí.
- Matrícula con «Inscribirlo en las asignaturas de su nivel».
"""
import os, re, sys
sys.path.insert(0, os.path.dirname(__file__))
from e2e import BASE, CHROME, PASS, sql, check, go, login, status_msg, results
from playwright.sync_api import sync_playwright

ORG = '0a000000-0000-4000-8000-000000000001'
def secs(email):
    return int(sql(f"select count(*) from section_enrollments se join students s on s.id=se.student_id where s.email='{email}' and se.status<>'dropped'"))

def main():
    # Escenario: nadie inscrito en secciones (como en una institución recién configurada)
    sql("update students set user_id=null where email='estudiante2.a@demo.sematec.test'")
    sql(f"delete from memberships where organization_id='{ORG}' and user_id=(select id from profiles where email='estudiante3.a@demo.sematec.test')")
    qid = sql(f"insert into quizzes (organization_id, section_id, title, opens_at, closes_at, published) select '{ORG}', s.id, 'Prueba borrador e2e', now(), now()+interval '7 days', false from sections s join courses c on c.id=s.course_id where c.code='BDD101' returning id").split('\n')[0]
    sql(f"insert into quiz_questions (organization_id, quiz_id, kind, prompt, options) values ('{ORG}', '{qid}', 'vf', '¿SQL es un lenguaje?', '[{{\"text\":\"Sí\",\"correct\":true}},{{\"text\":\"No\",\"correct\":false}}]'::jsonb)")
    with sync_playwright() as pw:
        b = pw.chromium.launch(executable_path=CHROME, headless=True, args=['--no-sandbox'])
        # El estudiante sin cursos entiende por qué
        c = b.new_context(); p = login(c, 'estudiante1.a@demo.sematec.test'); go(p, f'{BASE}/app/aula')
        check('todavía no está inscrito' in p.locator('[data-testid=sin-cursos]').inner_text(), 'Estudiante sin cursos: el Aula le explica por qué')
        c.close()

        c = b.new_context(); p = login(c, 'secretaria.a@demo.sematec.test'); go(p, f'{BASE}/app/aula')
        av = p.locator('[data-testid=aviso-acceso]').inner_text()
        check('3 estudiante(s)' in av, f'Aula: aviso de estudiantes que no ven sus cursos ({av[:60]})')
        p.click('text=Revisar acceso de estudiantes'); p.wait_for_url(re.compile(r'/app/aula/acceso')); p.wait_for_load_state('networkidle')
        t = p.locator('[data-testid=tabla-acceso]').inner_text()
        check('Cuenta sin vincular' in t and 'Sin acceso a la institución' in t and 'Sin cursos' in t, 'Informe: muestra el motivo de cada estudiante')
        row = p.locator('[data-testid=fila-acceso]', has_text='estudiante2.a@demo.sematec.test')
        row.locator('button:has-text("Vincular cuenta")').click(); m = status_msg(p)
        check('vinculada' in m and sql("select user_id is not null from students where email='estudiante2.a@demo.sematec.test'") == 't', 'Vincular cuenta: la ficha queda unida a su cuenta')
        go(p, f'{BASE}/app/aula/acceso')
        p.once('dialog', lambda d: d.accept()); p.click('button:has-text("Reparar todo")'); m = status_msg(p)
        check('acceso' in m and 'inscripción' in m, f'Reparar todo: {m[:140]}')
        check(sql(f"select count(*) from memberships where organization_id='{ORG}' and status='active' and user_id=(select id from profiles where email='estudiante3.a@demo.sematec.test')") == '1', 'El estudiante sin acceso recupera su rol de estudiante')
        n1, n2, n3 = secs('estudiante1.a@demo.sematec.test'), secs('estudiante2.a@demo.sematec.test'), secs('estudiante3.a@demo.sematec.test')
        check(min(n1, n2, n3) >= 1 and n1 + n2 + n3 == 5, f'Inscritos en las asignaturas de 1er semestre respetando el cupo ({n1},{n2},{n3})')
        check(sql("select count(*) from section_enrollments se join sections s on s.id=se.section_id join courses c on c.id=s.course_id where c.code='PRG201'") == '0', 'No los inscribe en asignaturas de otro semestre')
        check('sin cupo' in m, 'Avisa la asignatura que no tuvo cupo')
        # Evaluaciones en borrador
        ev = p.locator('[data-testid=evaluaciones-ocultas]').inner_text()
        check('Prueba borrador e2e' in ev, 'Informe: muestra el examen en borrador que nadie ve')
        p.locator('[data-testid=evaluaciones-ocultas] li', has_text='Prueba borrador e2e').locator('button:has-text("Publicar")').click(); status_msg(p)
        check(sql(f"select published from quizzes where id='{qid}'") == 't', 'Publicar desde el informe: el examen queda visible')
        c.close()

        # El estudiante ahora ve sus cursos y el examen
        c = b.new_context(); p = login(c, 'estudiante2.a@demo.sematec.test'); go(p, f'{BASE}/app/aula')
        check(p.locator('a[href^="/app/aula/"]').count() >= 1, 'El estudiante ve sus cursos en el Aula')
        sec = sql("select se.section_id from section_enrollments se join students s on s.id=se.student_id join sections x on x.id=se.section_id join courses c on c.id=x.course_id where s.email='estudiante2.a@demo.sematec.test' and c.code='BDD101'")
        go(p, f'{BASE}/app/aula/{sec}?t=examenes')
        check('Prueba borrador e2e' in p.content() and p.locator('text=Rendir examen').count() == 1, 'Ve la evaluación publicada y puede rendirla')
        c.close()

        # Al iniciar sesión, la ficha con su correo se vincula sola
        sql("update students set user_id=null where email='estudiante1.a@demo.sematec.test'")
        c = b.new_context(); p = login(c, 'estudiante1.a@demo.sematec.test'); go(p, f'{BASE}/app/aula')
        check(sql("select user_id is not null from students where email='estudiante1.a@demo.sematec.test'") == 't' and p.locator('a[href^="/app/aula/"]').count() >= 1, 'Al entrar, la ficha con su correo se vincula sola y ve sus cursos')
        c.close()

        # Matrícula con inscripción automática en las asignaturas
        sid = sql(f"insert into students (organization_id, campus_id, student_code, first_names, last_names, email) values ('{ORG}', '0a000000-0000-4000-8000-0000000000c1', 'AULA-E2E', 'Nora', 'Aula', 'nora.aula@demo.sematec.test') returning id").split('\n')[0]
        c = b.new_context(); p = login(c, 'secretaria.a@demo.sematec.test'); go(p, f'{BASE}/app/matriculas?estudiante={sid}')
        form = p.locator('form:has(input[name=aula_sections])')
        form.locator('select[name=program_id]').select_option(index=1)
        form.locator('button:has-text("Matricular")').click(); m = status_msg(p)
        check('asignatura' in m and secs('nora.aula@demo.sematec.test') >= 1, f'Matrícula: queda inscrita en sus asignaturas ({m[:120]})')
        c.close(); b.close()
    ok = sum(1 for r in results if r[0]); print(f'\n{ok}/{len(results)} verificaciones OK')

if __name__ == '__main__':
    main()
