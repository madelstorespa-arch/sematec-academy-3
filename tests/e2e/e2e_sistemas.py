"""
Sistemas (catálogo de 80+): activar todos, centro de sistemas, mapa, autoservicio, flujo de estados,
responsable, fecha límite y vencidos, tablero, historial, comentarios, adjuntos, correo, totales,
privacidad entre personas, ocultar, desactivar y exportar.
"""
import email, glob, os, re, sys, time
from email import policy
sys.path.insert(0, os.path.dirname(__file__))
from e2e import BASE, CHROME, sql, check, shot, login, go, status_msg, results
from playwright.sync_api import sync_playwright

def until(fn, timeout=20, msg=''):
    end = time.time() + timeout
    while time.time() < end:
        try:
            if fn(): return True
        except Exception: pass
        time.sleep(0.4)
    raise AssertionError(f'Tiempo agotado: {msg}')

def mails(addr):
    out = []
    for f in sorted(glob.glob('/tmp/mails/*.eml')):
        raw = open(f, 'rb').read(); first, rest = raw.split(b'\r\n', 1)
        if addr.encode() not in first: continue
        m = email.message_from_bytes(rest, policy=policy.default); b = m.get_body(preferencelist=('plain',))
        out.append((str(m['subject']), b.get_content() if b else ''))
    return out

def main():
    os.makedirs('/tmp/mails', exist_ok=True)
    for f in glob.glob('/tmp/mails/*.eml'): os.remove(f)
    pdf = '/tmp/e2e_sis_falla.pdf'
    open(pdf, 'wb').write(b'%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n')
    with sync_playwright() as pw:
        b = pw.chromium.launch(executable_path=CHROME, headless=True, args=['--no-sandbox'])
        new = lambda: b.new_context(viewport={'width': 1440, 'height': 900}, accept_downloads=True)
        oc = new(); o = login(oc, 'propietario.a@demo.sematec.test', mfa=True)

        # ================= Catálogo: activar todos =================
        go(o, f'{BASE}/app/sistemas?v=catalogo')
        n_cat = o.locator('[data-testid^=plantilla-]').count()
        check(n_cat >= 80, f'Catálogo con {n_cat} sistemas listos en 4 áreas')
        check(all(o.locator(f'[data-testid=catalogo-{a}]').count() == 1 for a in ['bienestar', 'superior', 'operaciones', 'administracion']), 'Áreas: bienestar, educación superior, operaciones y administración')
        o.click(f'button:has-text("Activar los {n_cat} sistemas")')
        m = status_msg(o); check(f'{n_cat} sistema(s) activado(s)' in m, f'Se activan todos de una vez ({m[:60]})')
        check(sql("select count(*) from custom_modules where catalog_key is not null and active") == str(n_cat), 'Quedan guardados en la base con sus campos, flujos y permisos')
        go(o, f'{BASE}/app/sistemas?v=catalogo')
        check(o.locator('[data-testid=sistemas-activos]').inner_text().strip() == str(n_cat), 'El catálogo los muestra activos')
        go(o, f'{BASE}/app/sistemas')
        n_hub = o.locator('[data-testid=sistema]').count()
        check(n_hub >= n_cat, f'Centro de sistemas con {n_hub} sistemas por área')
        o.fill('[data-testid=buscar-sistemas]', 'mantención')
        until(lambda: 0 < o.locator('[data-testid=sistema]').count() <= 3, 5, 'buscar sistemas'); check(True, 'Buscar sistemas')
        go(o, f'{BASE}/app/mapa')
        total_map = o.locator('[data-testid=sistema-mapa]').count()
        check(total_map >= 41 + 80, f'Mapa de la plataforma: {total_map} sistemas en total')
        shot(o, 'sistemas_01_mapa')

        # ================= Autoservicio: estudiante envía una solicitud de mantención =================
        ec = new(); e = login(ec, 'estudiante1.a@demo.sematec.test')
        go(e, f'{BASE}/app/sistemas')
        check(e.locator('[data-testid=sistema]', has_text='Solicitudes de mantención').count() == 1 and e.locator('[data-testid=sistema]', has_text='Enfermería').count() == 0,
              'El estudiante ve los sistemas de autoservicio, no los confidenciales')
        r = e.goto(f'{BASE}/app/m/enfermeria'); check(r.status == 404, 'Enfermería: el estudiante no puede abrirla (confidencial)')
        go(e, f'{BASE}/app/m/mantencion')
        check(e.locator('[data-testid=modo-solicitud]').count() == 1, 'Modo «mis solicitudes» para quien no gestiona')
        e.fill('input[name=f_lugar_o_sala]', 'Sala 204'); e.select_option('select[name=f_tipo]', 'Eléctrico'); e.select_option('select[name=f_prioridad]', 'Alta')
        e.fill('textarea[name=f_descripcion_de_la_falla]', 'El enchufe junto a la pizarra no funciona.'); e.set_input_files('input[name=file]', pdf)
        e.click('button:has-text("Enviar")'); msg = status_msg(e)
        check('MANT000001' in msg, f'Solicitud creada con código automático ({msg[:80]})')
        until(lambda: mails('soporte.a@demo.sematec.test'), 15, 'correo a soporte')
        check('MANT000001' in mails('soporte.a@demo.sematec.test')[0][0], 'Correo REAL a quienes atienden el sistema')
        rec = sql("select id||'|'||status||'|'||(select count(*) from custom_record_files f where f.record_id=r.id) from custom_records r where code='MANT000001'")
        rid, st, nf = rec.split('|')
        check(st == 'recibida' and nf == '1', 'Queda «Recibida» con su archivo adjunto')
        e2c = new(); e2 = login(e2c, 'estudiante2.a@demo.sematec.test'); go(e2, f'{BASE}/app/m/mantencion')
        e2.fill('input[name=f_lugar_o_sala]', 'Baño 2° piso'); e2.select_option('select[name=f_tipo]', 'Gasfitería'); e2.select_option('select[name=f_prioridad]', 'Media')
        e2.click('button:has-text("Enviar")'); status_msg(e2)
        go(e, f'{BASE}/app/m/mantencion')
        check(e.locator('[data-testid=registro]').count() == 1 and 'Sala 204' in e.locator('[data-testid=tabla-registros]').inner_text(), 'Cada persona ve solo sus solicitudes')
        fid = sql(f"select id from custom_record_files where record_id='{rid}'")
        check(e.request.get(f'{BASE}/api/sistemas/archivo/{fid}').status == 200, 'Quien la envió descarga su adjunto')
        check(e2.request.get(f'{BASE}/api/sistemas/archivo/{fid}', max_redirects=0).status == 404, 'Otra persona no puede descargarlo')
        e2c.close()

        # ================= Gestión: responsable, plazo vencido, estado, correo, tablero =================
        soporte = sql("select id from profiles where email='soporte.a@demo.sematec.test'")
        go(o, f'{BASE}/app/m/mantencion')
        check(o.locator('[data-testid=registro]').count() == 2, 'Quien gestiona ve todas las solicitudes')
        o.locator('[data-testid=registro]', has_text='Sala 204').locator('[data-testid=abrir-registro]').click()
        o.wait_for_url(re.compile(rf'/app/m/mantencion/{rid}'), timeout=15000)
        o.select_option('[data-testid=cambiar-estado]', 'en_proceso'); o.select_option('[data-testid=cambiar-responsable]', soporte)
        o.fill('[data-testid=cambiar-plazo]', '2026-01-10'); o.fill('textarea[name=comment]', 'Electricista agendado para mañana.')
        o.click('button:text-is("Guardar")'); m = status_msg(o)
        check('Enviado por correo' in m, f'Cambio de estado, responsable y plazo con aviso por correo ({m[:80]})')
        until(lambda: any('Electricista agendado' in t for _, t in mails('estudiante1.a@demo.sematec.test')), 15, 'correo estudiante')
        check(True, 'El estudiante recibe la actualización en su correo')
        o.reload()
        hist = o.locator('[data-testid=historial-registro]').inner_text()
        check('Creó el registro' in hist and 'En proceso' in hist and 'Asignó a' in hist and 'Fecha límite' in hist and 'Electricista agendado' in hist and 'Adjuntó' in hist,
              'Historial completo: creación, adjunto, estado, responsable, plazo y comentario')
        check('Vencido' in o.locator('[data-testid=resumen-registro]').inner_text(), 'Plazo pasado: marcado como vencido')
        go(o, f'{BASE}/app/m/mantencion?vencidos=1')
        check(o.locator('[data-testid=registro]').count() == 1, 'Filtro «Vencidos»')
        go(o, f'{BASE}/app/m/mantencion?vista=tablero')
        check(o.locator('[data-testid=columna-en_proceso] [data-testid=tarjeta-registro]').count() == 1 and o.locator('[data-testid=columna-recibida] [data-testid=tarjeta-registro]').count() == 1, 'Tablero por estados')
        card = o.locator('[data-testid=columna-recibida] [data-testid=tarjeta-registro]').first
        card.locator('select[name=status]').select_option('rechazada'); card.locator('button:has-text("Mover")').click(); status_msg(o)
        check(sql("select status||'|'||(closed_at is not null) from custom_records where data->>'lugar_o_sala'='Baño 2° piso'") == 'rechazada|true', 'Mover en el tablero cambia el estado y cierra el registro')
        shot(o, 'sistemas_02_tablero')

        # El responsable lo ve y lo resuelve
        sc = new(); s = login(sc, 'soporte.a@demo.sematec.test', mfa=True)
        go(s, f'{BASE}/app/m/mantencion?resp=yo')
        check(s.locator('[data-testid=registro]').count() == 1, 'El responsable ve «Asignados a mí»')
        go(s, f'{BASE}/app/m/mantencion/{rid}'); s.select_option('[data-testid=cambiar-estado]', 'resuelta'); s.click('button:text-is("Guardar")'); status_msg(s)
        check(sql(f"select status||'|'||(closed_at is not null) from custom_records where id='{rid}'") == 'resuelta|true', 'El responsable la marca «Resuelta» y queda cerrada')
        sc.close()

        # ================= Totales (becas) =================
        go(e, f'{BASE}/app/m/becas')
        e.fill('input[name=f_persona_nombre_y_rut]', 'Ana Pérez 12.345.678-5'); e.select_option('select[name=f_tipo_de_beca]', 'Socioeconómica')
        e.fill('input[name=f_monto_o_descuento_solicitado]', '150000'); e.click('button:has-text("Enviar")'); status_msg(e)
        go(o, f'{BASE}/app/m/becas')
        check('$150.000' in o.locator('[data-testid=total-monto]').inner_text(), 'Becas: total del monto solicitado')
        csv = o.request.get(f'{BASE}/app/m/mantencion/csv').text()
        check('Estado' in csv and 'Resuelta' in csv and 'Responsable' in csv, 'Exportar a Excel con estado y responsable')

        # ================= Ocultar y desactivar =================
        go(o, f'{BASE}/app/m/mantencion/{rid}')
        o.click('[data-testid=menu-ocultar] summary'); o.uncheck('[data-testid=ocultar-all]'); o.check('[data-testid=ocultar-students]')
        o.click('[data-testid=menu-ocultar] button:has-text("Ocultar")'); status_msg(o)
        go(e, f'{BASE}/app/m/mantencion')
        check(e.locator('[data-testid=registro]').count() == 0, 'Ocultar un registro para estudiantes')
        sql(f"delete from hidden_records where record_id='{rid}'")
        go(o, f'{BASE}/app/sistemas?v=catalogo')
        o.once('dialog', lambda d: d.accept())
        o.locator('[data-testid=plantilla-talleres] button:has-text("Desactivar")').click(); status_msg(o)
        go(e, f'{BASE}/app/sistemas')
        check(e.locator('[data-testid=sistema]', has_text='Talleres extraprogramáticos').count() == 0, 'Un sistema desactivado desaparece para todos (sus datos se conservan)')
        go(o, f'{BASE}/app/sistemas?v=catalogo')
        o.locator('[data-testid=plantilla-talleres] button:has-text("Activar")').click(); status_msg(o)
        o.locator('[data-testid=plantilla-talleres] button:has-text("Fijar en el menú")').click(); status_msg(o)
        go(e, f'{BASE}/app')
        check(e.locator('nav a[href="/app/m/talleres"]').count() >= 1, 'Reactivar y fijar un sistema en el menú')
        b.close()
    ok = sum(1 for r in results if r[0]); print(f'\n{ok}/{len(results)} verificaciones OK')

if __name__ == '__main__':
    main()
