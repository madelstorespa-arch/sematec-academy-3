'use client';
import { useEffect, useState } from 'react';
import { ActionForm } from '@/components/forms';
import { hiddenStates, hideRecord, unhideRecord } from '@/app/app/hide-actions';
import { AUDIENCES, PUBLIC_TABLES } from '@/lib/hideable';

type St = { audience: string[]; until: string | null; reason: string | null };
// Las filas de una página piden su estado juntas (una sola consulta)
let queue: { id: string; done: (s: St | null) => void }[] = [];
let timer: ReturnType<typeof setTimeout> | null = null;
function stateOf(id: string) {
  return new Promise<St | null>((done) => {
    queue.push({ id, done });
    if (!timer) timer = setTimeout(async () => {
      const batch = queue; queue = []; timer = null;
      const r = await hiddenStates(batch.map((b) => b.id)).catch(() => ({} as Record<string, St>));
      batch.forEach((b) => b.done(r[b.id] ?? null));
    }, 60);
  });
}
const LABEL = Object.fromEntries(AUDIENCES);

/** 👁 «Ocultar para… / por…»: elegir a quién y por cuánto tiempo; muestra si ya está oculto. */
export function HideMenu({ table, id, path }: { table: string; id: string; path: string }) {
  const [st, setSt] = useState<St | null | undefined>(undefined);
  const [dur, setDur] = useState('siempre');
  useEffect(() => { let alive = true; stateOf(id).then((s) => { if (alive) setSt(s); }); return () => { alive = false; }; }, [id]);
  const hidden = (k: string) => (<><input type="hidden" name="table" value={table} /><input type="hidden" name="id" value={id} /><input type="hidden" name="path" value={path} /><input type="hidden" name="k" value={k} /></>);
  const auds = AUDIENCES.filter(([k]) => k !== 'public' || PUBLIC_TABLES.has(table));
  return (
    <details className="relative inline-block" data-testid="menu-ocultar">
      <summary className={`btn-secondary btn-sm cursor-pointer list-none ${st ? 'border-amber-400 bg-amber-50 text-amber-900' : ''}`} title="Ocultar para… / por…">
        {st ? `🙈 Oculto: ${st.audience.map((a) => LABEL[a] ?? a).join(', ')}${st.until ? ` · hasta ${new Date(st.until).toLocaleDateString('es-CL')}` : ''}` : '👁 Ocultar'}
      </summary>
      <div className="absolute right-0 z-40 mt-1 w-80 rounded-xl border border-slate-200 bg-white p-3 text-left text-sm shadow-2xl">
        {st && (
          <div className="mb-3 rounded-lg bg-amber-50 p-2 text-xs text-amber-900">Oculto para <b>{st.audience.map((a) => LABEL[a] ?? a).join(', ')}</b>{st.until ? ` hasta el ${new Date(st.until).toLocaleString('es-CL')}` : ' hasta que lo vuelva a mostrar'}.{st.reason ? ` Motivo: ${st.reason}` : ''}
            <div className="mt-2"><ActionForm action={unhideRecord} inline submitLabel="👁 Mostrar de nuevo" submitClass="btn-secondary btn-sm" onDone={() => setSt(null)}>{hidden('show')}</ActionForm></div>
          </div>)}
        <ActionForm action={hideRecord} submitLabel={st ? 'Cambiar' : '🙈 Ocultar'} submitClass="btn-primary btn-sm" resetOnSuccess={false}
          onDone={(r) => { if (r.ok) stateOf(id).then(setSt); }}>
          {hidden('hide')}
          <p className="label">Ocultar para</p>
          <div className="grid grid-cols-2 gap-1">{auds.map(([k, l]) => (
            <label key={k} className="flex items-center gap-1.5"><input type="checkbox" name="audience" value={k} defaultChecked={st ? st.audience.includes(k) : k === 'all'} data-testid={`ocultar-${k}`} />{l}</label>))}</div>
          <label className="mt-2 block"><span className="label">Por cuánto tiempo</span>
            <select className="input" name="duration" value={dur} onChange={(e) => setDur(e.target.value)} data-testid="ocultar-duracion">
              <option value="siempre">Hasta que lo vuelva a mostrar</option><option value="1h">1 hora</option><option value="1d">1 día</option>
              <option value="7d">1 semana</option><option value="30d">30 días</option><option value="fecha">Hasta una fecha…</option></select></label>
          {dur === 'fecha' && <input className="input mt-1" type="date" name="until" required />}
          <label className="mt-2 block"><span className="label">Motivo (opcional)</span><input className="input" name="reason" maxLength={200} /></label>
          <p className="text-xs text-slate-500">Usted y la administración lo siguen viendo, con esta marca.</p>
        </ActionForm>
      </div>
    </details>
  );
}
