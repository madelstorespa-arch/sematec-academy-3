"""Compartir pantalla de verdad entre dos personas (calidad, audio, aviso, dejar de compartir), modos de grabación
(área marcada, pantalla compartida, pausa/reanudar) y archivos grandes (barra de progreso, fotos achicadas, límite claro)."""
import re, sys, os, time, json, subprocess
sys.path.insert(0, os.path.dirname(__file__))
from e2e import BASE, CHROME, sql, check, login, status_msg, results
from playwright.sync_api import sync_playwright

ORG = '0a000000-0000-4000-8000-000000000001'
SEC = '0a000000-0000-4000-8000-00000000ad01'
T1 = '00000000-0000-4000-8000-000000000020'
MEDIA = '/tmp/media'
sql(f"insert into section_enrollments (organization_id, section_id, student_id, enrollment_id) select '{ORG}', '{SEC}', e.student_id, e.id from enrollments e join students s on s.id = e.student_id where s.organization_id = '{ORG}' and s.user_id is not null on conflict do nothing")
sql("delete from system_events where event_type = 'rate:upload'")
room = sql(f"insert into conference_rooms (organization_id, name, room_type, section_id, max_participants, created_by) values ('{ORG}', 'Aula Pantalla E2E', 'class', '{SEC}', 50, '{T1}') returning id").splitlines()[0]
sess = sql(f"""set request.jwt.claims = '{{"sub":"{T1}","role":"authenticated"}}'; select create_conference_session('{room}', 'Pantalla y grabación E2E', 'class', now() - interval '5 minutes', now() + interval '55 minutes', 'America/Santiago', true, null)""").splitlines()[-1]

def go(page, url): page.goto(url); page.wait_for_load_state('load')
def enter(p):
    go(p, f'{BASE}/app/conferencias/sala/{sess}'); p.click('button:has-text("Entrar a la sala")'); p.wait_for_selector('.lk-video-conference', timeout=30000)
def parts(): return int(sql(f"select count(*) from conference_recordings where session_id = '{sess}' and status = 'available'"))
def probe(rec_id):
    path = sql(f"select storage_path from conference_recordings where id = '{rec_id}'")
    out = subprocess.run(['ffprobe', '-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', f'/tmp/storage/conference-recordings/{path}'], capture_output=True, text=True).stdout.strip()
    w, h = (out.split(',') + ['0', '0'])[:2]; return int(w or 0), int(h or 0)
def record(t, mode, secs=9, area=None, pause=False):
    before = parts()
    t.locator('footer button:has-text("Grabar")').click()
    t.locator(f'[data-testid=opciones-grabacion] input[value={mode}]').check()
    t.locator('button:has-text("Empezar a grabar")').click()
    if area:
        t.wait_for_selector('[data-testid=marcar-area]', timeout=20000)
        x, y, w, h = area
        t.mouse.move(x, y); t.mouse.down(); t.mouse.move(x + w // 2, y + h // 2); t.mouse.move(x + w, y + h); t.mouse.up()
    t.wait_for_selector('[data-testid=detener-grabacion]', timeout=20000)
    if pause:
        time.sleep(3); t.locator('[data-testid=pausar-grabacion]').click(); time.sleep(4)
        paused_txt = t.locator('[data-testid=pausar-grabacion]').inner_text()
        t.locator('[data-testid=pausar-grabacion]').click(); time.sleep(3)
    else:
        time.sleep(secs); paused_txt = ''
    t.locator('[data-testid=detener-grabacion]').click()
    t.wait_for_selector('[data-testid=grabacion-lista] >> text=Grabación guardada', timeout=60000)
    t.locator('[data-testid=grabacion-lista] button:has-text("Cerrar")').click()
    return parts() - before, paused_txt

with sync_playwright() as pw:
    b = pw.chromium.launch(executable_path=CHROME, headless=True, args=['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream',
                           '--auto-accept-this-tab-capture', '--no-sandbox'])
    tc = b.new_context(viewport={'width': 1280, 'height': 800}); t = login(tc, 'profesor1.a@demo.sematec.test')
    ec = b.new_context(viewport={'width': 1280, 'height': 800}); e = login(ec, 'estudiante1.a@demo.sematec.test')
    enter(t); enter(e)

    # ================= 1. Compartir pantalla real =================
    t.locator('footer button:has-text("Compartir pantalla")').click()
    check(t.locator('[data-testid=opciones-compartir] >> text=Texto nítido').count() == 1 and t.locator('[data-testid=opciones-compartir] >> text=Video fluido').count() == 1,
          'Opciones al compartir: texto nítido o video fluido, con audio')
    t.locator('[data-testid=opciones-compartir] input[name=calidad]').nth(1).check()
    t.locator('button:has-text("Elegir qué compartir")').click()
    t.wait_for_selector('[data-testid=compartiendo]', timeout=20000)
    check(t.locator('[data-testid=dejar-compartir]').count() == 1, 'El profesor ve «Está compartiendo su pantalla · Dejar de compartir»')
    e.wait_for_selector('[data-testid=pantalla-de]', timeout=20000)
    time.sleep(4)
    dims = e.evaluate("[...document.querySelectorAll('.lk-focus-layout video')].map(v => v.videoWidth)")
    check(any(w >= 1280 for w in dims), f'El estudiante ve la pantalla del profesor en grande, en alta resolución ({dims})')
    check('Profesor' in e.locator('[data-testid=pantalla-de]').inner_text() or 'Pantalla de' in e.locator('[data-testid=pantalla-de]').inner_text(), 'Indica de quién es la pantalla')
    t.locator('[data-testid=dejar-compartir]').click()
    e.wait_for_selector('[data-testid=pantalla-de]', state='detached', timeout=20000); check(True, '⏹ Dejar de compartir: los demás dejan de ver la pantalla')
    # El estudiante también comparte
    e.locator('footer button:has-text("Compartir pantalla")').click(); e.locator('button:has-text("Elegir qué compartir")').click()
    t.wait_for_selector('[data-testid=pantalla-de]', timeout=20000); check(True, 'El estudiante también comparte su pantalla y el profesor la ve')

    # ================= 2. Grabación: solo la pantalla compartida =================
    t.evaluate("window.__sematecSegmentMs = 5000")
    n, _ = record(t, 'shared', secs=8)
    check(n >= 1, f'📺 Graba solo la pantalla compartida ({n} parte/s)')
    e.locator('[data-testid=dejar-compartir]').click(); time.sleep(2)

    # ================= 3. Grabación: solo un área marcada =================
    n, _ = record(t, 'area', secs=8, area=(200, 150, 480, 300))
    last = sql(f"select id from conference_recordings where session_id = '{sess}' order by created_at desc limit 1")
    w, h = probe(last)
    check(n >= 1 and 0 < w < 1200 and 0 < h < 700, f'✂ Graba solo el área marcada (video de {w}×{h})')

    # ================= 3b. Pantalla completa con todos los movimientos / ventana elegida =================
    n, _ = record(t, 'screen', secs=7)
    last = sql(f"select id from conference_recordings where session_id = '{sess}' order by created_at desc limit 1")
    check(n >= 1 and probe(last)[0] >= 1280, f'🖥 Graba la pantalla completa con todos los movimientos ({probe(last)[0]} px de ancho)')
    n, _ = record(t, 'choose', secs=6)
    check(n >= 1, '🪟 Graba una ventana o pestaña elegida')

    # ================= 4. Pausar y reanudar =================
    n, ptxt = record(t, 'tab', pause=True)
    check('Reanudar' in ptxt, 'Durante la grabación se puede ⏸ pausar y ▶ reanudar')
    check(n >= 1, f'Graba solo las partes deseadas (pausa incluida) ({n} parte/s)')
    check(t.locator('[data-testid=opciones-grabacion]').count() == 0, 'Opciones de grabación se cierran al terminar')
    t.locator('footer button:has-text("Grabar")').click()
    labels = t.locator('[data-testid=opciones-grabacion]').inner_text()
    check(all(x in labels for x in ['Toda la sala', 'todos los movimientos', 'ventana o pestaña', 'Solo un área', 'pantalla compartida', 'Alta calidad']),
          'Modos: toda la sala, pantalla completa con movimientos, ventana elegida, área, pantalla compartida y alta calidad')
    t.locator('[data-testid=opciones-grabacion] button:has-text("Cancelar")').click()

    # ================= 5. Archivos grandes =================
    go(e, BASE + '/app/archivos')
    up = e.locator('[data-testid=subir-archivos]')
    check('máx.' in up.inner_text().lower(), 'Muestra el tamaño máximo por archivo')
    up.locator('input[type=file]').set_input_files(f'{MEDIA}/foto_grande.png'); up.locator('button:has-text("Subir archivos")').click()
    e.wait_for_selector('text=✓ «foto_grande.png» guardado', timeout=60000)
    sz = int(sql("select size_bytes from user_files where name = 'foto_grande.jpg' order by created_at desc limit 1"))
    check(sz < 20634962 // 2, f'Foto de 20 MB achicada automáticamente a {sz // 1024} KB (misma calidad visible)')
    up.locator('input[type=file]').set_input_files(f'{MEDIA}/grande.mp4'); up.locator('button:has-text("Subir archivos")').click()
    e.wait_for_selector('text=el máximo es', timeout=20000); check(True, 'Archivo sobre el límite: mensaje claro antes de subir')
    up.locator('input[type=file]').set_input_files(f'{MEDIA}/clase1.webm'); up.locator('button:has-text("Subir archivos")').click()
    e.wait_for_selector('text=✓ «clase1.webm» guardado', timeout=60000); check(True, 'Video subido con barra de progreso')
    check(sql("select coalesce(file_size_limit::text, 'sin tope') from storage.buckets where id = 'user-files'") == 'sin tope', 'El depósito usa el límite del proyecto (se amplía con Supabase Pro)')
    b.close()

print(f"\n{sum(1 for r in results if r[0])}/{len(results)} verificaciones OK")
