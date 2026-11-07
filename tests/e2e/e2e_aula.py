"""Aula de aprendizaje: contenidos, tareas, exámenes en línea y foro (profesor ↔ estudiante)."""
import re, sys, os, datetime
sys.path.insert(0, os.path.dirname(__file__))
from e2e import BASE, CHROME, sql, check, shot, login, status_msg, go, sel_re, results
from playwright.sync_api import sync_playwright
from PIL import Image

SEC = '0a000000-0000-4000-8000-00000000ad03'
sql(f"insert into section_enrollments (organization_id, section_id, student_id, enrollment_id) select '0a000000-0000-4000-8000-000000000001', '{SEC}', student_id, id from enrollments where student_id='0a000000-0000-4000-8000-00000000a501' limit 1 on conflict do nothing")
sql(f"insert into assessments (organization_id, section_id, name, weight_pct, published) values ('0a000000-0000-4000-8000-000000000001','{SEC}','Control online',20,true) on conflict do nothing")
pdf = '/tmp/apunte.pdf'; Image.new('RGB', (200, 100), 'white').save(pdf)
now = datetime.datetime.now()
fmt = lambda d: d.strftime('%Y-%m-%dT%H:%M')
URL = f'{BASE}/app/aula/{SEC}'
with sync_playwright() as pw:
    b = pw.chromium.launch(executable_path=CHROME, headless=True, args=['--no-sandbox'])
    tc = b.new_context(viewport={'width': 1366, 'height': 900}); t = login(tc, 'profesor2.a@demo.sematec.test')
    go(t, BASE + '/app/aula'); check(t.locator(f'a[href="/app/aula/{SEC}"]').count() == 1, 'Profesor ve su curso en el Aula')
    # Contenidos
    go(t, URL); t.click('summary:has-text("Nueva unidad")'); t.fill('input[name=title]', 'Unidad 1: Introducción'); t.click('button:has-text("Crear unidad")')
    check('creada' in status_msg(t), 'Profesor crea una unidad')
    go(t, URL); t.click('summary:has-text("Agregar contenido")'); sel_re(t, 'select[name=unit_id]', 'Unidad 1')
    t.locator('details:has(summary:has-text("Agregar contenido")) input[name=title]').fill('Apunte clase 1')
    t.set_input_files('input[name=file]', pdf); t.click('button:has-text("Publicar")')
    check('publicado' in status_msg(t), 'Profesor sube un PDF al curso')
    # Tarea
    go(t, URL + '?t=tareas'); t.click('summary:has-text("Nueva tarea")'); t.fill('input[name=title]', 'Tarea 1 E2E')
    t.fill('input[name=due_at]', fmt(now + datetime.timedelta(days=2))); sel_re(t, 'select[name=assessment_id]', 'Control online')
    t.click('button:has-text("Publicar tarea")'); check('publicada' in status_msg(t), 'Profesor publica una tarea vinculada al libro de notas')
    # Examen
    go(t, URL + '?t=examenes'); t.click('summary:has-text("Nuevo examen")'); t.fill('input[name=title]', 'Control 1 E2E')
    t.fill('input[name=opens_at]', fmt(now - datetime.timedelta(minutes=5))); t.fill('input[name=closes_at]', fmt(now + datetime.timedelta(days=1)))
    t.fill('input[name=time_limit_min]', '20'); t.click('button:has-text("Crear examen")'); check('creado' in status_msg(t), 'Profesor crea un examen')
    go(t, URL + '?t=examenes'); t.click('a:has-text("Preguntas y resultados")'); t.wait_for_url(re.compile(r'/examen/'))
    for prompt, kind, opts in [('¿Cuánto es 2+2?', 'unica', '3\n*4\n5'), ('Marque lenguajes de BD', 'multiple', '*SQL\nHTML\n*PL/SQL'), ('SQL significa Structured Query Language', 'vf', '*Verdadero')]:
        t.fill('textarea[name=prompt]', prompt); t.select_option('select[name=kind]', kind); t.fill('textarea[name=options]', opts); t.click('button:has-text("Agregar")')
        status_msg(t); t.wait_for_selector(f'text={prompt}')
    check(t.locator('text=✔').count() == 4, 'Examen con 3 preguntas y respuestas correctas marcadas')
    t.click('button:has-text("Publicar examen")'); status_msg(t)
    # Foro
    go(t, URL + '?t=foro'); t.click('summary:has-text("Nuevo tema")'); t.fill('input[name=title]', 'Dudas de la unidad 1'); t.fill('textarea[name=body]', 'Pregunten aquí.')
    t.click('button:has-text("Publicar")'); check('publicado' in status_msg(t), 'Profesor abre un tema en el foro')
    # Estudiante (celular)
    ec = b.new_context(viewport={'width': 390, 'height': 844}, is_mobile=True); e = login(ec, 'estudiante1.a@demo.sematec.test')
    go(e, BASE + '/app/aula'); e.click(f'a[href="/app/aula/{SEC}"]'); e.wait_for_selector('text=Apunte clase 1')
    check(e.locator('text=Unidad 1: Introducción').count() == 1, 'Estudiante ve la unidad y el apunte'); shot(e, 'aula_contenidos_celular')
    with e.expect_download() as dl: e.click('a:has-text("Apunte clase 1")')
    check(dl.value.suggested_filename == 'apunte.pdf', 'Estudiante descarga el PDF')
    other = b.new_context(); o = login(other, 'estudiante2.a@demo.sematec.test')
    fid = sql("select id from lms_files limit 1"); r = o.request.get(f'{BASE}/app/aula/archivo/{fid}')
    check(r.status == 404, 'Alumno de otra sección no puede descargar el archivo'); other.close()
    go(e, URL + '?t=tareas'); e.fill('textarea[name=body]', 'Mi desarrollo de la tarea'); e.set_input_files('input[name=file]', pdf); e.click('button:has-text("Entregar")')
    check('recibida' in status_msg(e), 'Estudiante entrega la tarea con archivo')
    go(e, URL + '?t=examenes'); e.click('a:has-text("Rendir examen")'); e.click('button:has-text("Comenzar examen")')
    e.wait_for_selector('text=Tiempo restante'); shot(e, 'aula_examen_celular')
    e.click('label:has-text("4")'); e.click('label:has-text("SQL") >> nth=0'); e.click('label:has-text("PL/SQL")'); e.click('label:has-text("Falso")')
    e.once('dialog', lambda d: d.accept()); e.click('button:has-text("Enviar examen")')
    e.wait_for_selector('text=Examen enviado', timeout=20000); msg = e.locator('text=Examen enviado').inner_text(); print('   ', msg)
    check('Puntaje: 2 de 3' in msg, 'Corrección automática: 2 de 3 correctas')
    go(e, URL + '?t=examenes'); check(e.locator('a:has-text("Rendir examen")').count() == 0, 'No permite un segundo intento')
    go(e, URL + '?t=foro'); e.click('text=Dudas de la unidad 1'); e.fill('textarea[name=body]', '¿Entra la unidad 2 en la prueba?'); e.click('button:has-text("Publicar respuesta")')
    check('publicada' in status_msg(e), 'Estudiante responde en el foro')
    # Profesor califica
    go(t, URL + '?t=tareas'); t.click('a:has-text("Ver entregas")'); t.wait_for_selector('text=Mi desarrollo de la tarea')
    t.fill('input[name=score]', '80'); t.fill('input[name=feedback]', 'Bien, falta conclusión'); t.click('button:has-text("Guardar calificación")')
    m = status_msg(t); print('   ', m); check('Nota en el libro de clases: 5.8' in m, 'Calificación 80/100 → nota 5.8 en el libro oficial')
    go(e, URL + '?t=tareas'); check(e.locator('text=Calificada: 80').count() == 1, 'Estudiante ve su nota y comentario'); shot(e, 'aula_tarea_calificada_celular')
    b.close()
print(f"\n{sum(1 for ok, _ in results if ok)}/{len(results)} pruebas OK")
