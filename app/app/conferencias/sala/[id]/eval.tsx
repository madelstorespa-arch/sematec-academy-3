'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useDataChannel } from '@livekit/components-react';
import type { Participant } from 'livekit-client';
import { createRoomAssessment, getRoomEval, saveRoomGrades, type EvalData, type EvalItem } from '@/app/app/conferencias/eval-actions';

const enc = new TextEncoder();
const dec = new TextDecoder();
export type Launched = { id: string; kind: 'quiz' | 'ext'; title: string; section: string };

const linkOf = (l: Launched) => (l.kind === 'quiz' ? `/app/aula/${l.section}/examen/${l.id}/rendir` : `/app/aula/evaluacion/${l.id}`);
const fmt = (n: number | null | undefined, d = 1) => (n == null ? '—' : n.toLocaleString('es-CL', { minimumFractionDigits: d, maximumFractionDigits: d }));

/** 📣 El profesor lanza una evaluación y a cada estudiante le aparece un aviso para rendirla. */
export function useEvalLaunch() {
  const [launched, setLaunched] = useState<Launched | null>(null);
  const { send } = useDataChannel('evaluacion', (m) => {
    try { const j = JSON.parse(dec.decode(m.payload)) as Launched; if (j?.id && j.section) setLaunched(j); } catch { /* mensaje inválido */ }
  });
  const launch = useCallback((l: Launched) => { send(enc.encode(JSON.stringify(l)), { reliable: true }); }, [send]);
  return { launched, launch, dismiss: () => setLaunched(null) };
}

export function EvalBanner({ launched, onClose }: { launched: Launched | null; onClose: () => void }) {
  if (!launched) return null;
  return (
    <div className="absolute inset-x-2 top-3 z-30 mx-auto max-w-lg rounded-2xl border border-white/10 bg-[#1f2a44] p-4 text-sm shadow-2xl" data-testid="evaluacion-lanzada">
      <p className="text-xs font-bold uppercase tracking-wide text-sky-300">📝 Evaluación en vivo</p>
      <p className="mt-1 text-base font-semibold">{launched.title}</p>
      <p className="mt-1 opacity-80">Se abre en otra pestaña: la clase sigue aquí.</p>
      <div className="mt-3 flex gap-2">
        <a href={linkOf(launched)} target="_blank" rel="noopener noreferrer" className="rounded-lg bg-blue-600 px-4 py-2 font-semibold hover:bg-blue-500" onClick={onClose} data-testid="rendir-ahora">▶ Rendir ahora</a>
        <button className="rounded-lg bg-white/10 px-3 py-2 hover:bg-white/20" onClick={onClose}>Más tarde</button>
      </div>
    </div>
  );
}

/** 📝 Panel de Evaluación y calificación dentro de la clase en vivo. */
export function EvalPanel({ sessionId, participants, onLaunch, say }: { sessionId: string; participants: Participant[]; onLaunch: (l: Launched) => void; say: (m: string) => void }) {
  const [d, setD] = useState<EvalData | null>(null);
  const [tab, setTab] = useState<'calificar' | 'lanzar'>('calificar');
  const [aid, setAid] = useState('');
  const [vals, setVals] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [onlyHere, setOnlyHere] = useState(true);
  const [newName, setNewName] = useState('Participación en clase');
  const [newW, setNewW] = useState('10');
  const load = useCallback(async () => { const r = await getRoomEval(sessionId); setD(r); }, [sessionId]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (!d?.assessments?.length) return;
    if (!aid || !d.assessments.some((a) => a.id === aid)) setAid(d.assessments[d.assessments.length - 1].id);
  }, [d, aid]);
  useEffect(() => {
    if (!d?.grades || !aid) return;
    const v: Record<string, string> = {};
    for (const g of d.grades) if (g.assessment_id === aid) v[g.student_id] = String(g.grade).replace('.', ',');
    setVals(v);
  }, [d, aid]);
  const here = useMemo(() => new Set(participants.map((p) => p.identity)), [participants]);
  if (!d) return <div className="flex-1 p-4 text-sm opacity-70" data-testid="panel-evaluacion">Cargando evaluaciones…</div>;
  if (!d.ok) return <div className="flex-1 p-4 text-sm text-amber-300" data-testid="panel-evaluacion">{d.error}</div>;
  if (!d.sectionId) return <div className="flex-1 p-4 text-sm opacity-80" data-testid="panel-evaluacion">Esta sala no está vinculada a una asignatura. Las evaluaciones y notas se usan en las clases de un curso (Aula virtual → curso → «Clase en vivo»).</div>;
  const items = d.items ?? [];
  const full = `/app/aula/${d.sectionId}?t=evaluacion`;

  // ---------- Estudiante ----------
  if (!d.manager) {
    return (
      <div className="flex-1 space-y-4 overflow-y-auto p-3 text-sm" data-testid="panel-evaluacion">
        <section>
          <p className="mb-2 text-xs font-bold uppercase opacity-60">Para rendir ahora</p>
          {items.filter((i) => i.open).length ? items.filter((i) => i.open).map((i) => (
            <a key={i.id} className="mb-2 flex items-center justify-between rounded-lg bg-blue-600/30 px-3 py-2 hover:bg-blue-600/50" target="_blank" rel="noopener noreferrer"
              href={linkOf({ ...i, section: d.sectionId! })}>{i.kind === 'quiz' ? '✅' : '🔗'} {i.title}<span className="text-xs">Rendir ▶</span></a>))
            : <p className="opacity-70">No hay evaluaciones abiertas en este momento.</p>}
        </section>
        <section>
          <p className="mb-2 text-xs font-bold uppercase opacity-60">Mis notas · {d.course}</p>
          {d.mine?.length ? (
            <table className="w-full text-xs"><tbody>{d.mine.map((m) => (
              <tr key={m.name} className="border-b border-white/5"><td className="py-1.5">{m.name}</td><td className="opacity-60">{fmt(m.weight_pct, 0)} %</td>
                <td className={`text-right font-bold ${m.grade != null && m.grade < (d.scale?.passing ?? 4) ? 'text-red-300' : ''}`}>{fmt(m.grade, d.scale?.decimals)}</td></tr>))}</tbody></table>)
            : <p className="opacity-70">Aún no hay evaluaciones publicadas.</p>}
          <p className="mt-2 rounded-lg bg-white/5 p-2" data-testid="mi-promedio">Promedio: <b>{fmt(d.average, 2)}</b> · aprueba con {fmt(d.scale?.passing)}</p>
        </section>
        <a className="block text-center text-xs underline opacity-80" href={full} target="_blank" rel="noopener noreferrer">Ver todo en el aula ↗</a>
      </div>
    );
  }

  // ---------- Profesor ----------
  const students = (d.students ?? []).filter((s) => !onlyHere || (s.user_id && here.has(s.user_id)));
  const save = async () => {
    if (!aid) return say('Elija o cree una evaluación.');
    setBusy(true);
    const r = await saveRoomGrades(sessionId, aid, Object.entries(vals).map(([student_id, grade]) => ({ student_id, grade })));
    setBusy(false);
    if (r.ok) { say(`✓ ${r.count} nota(s) guardada(s) en el libro de notas.`); load(); } else say(r.error ?? 'No se pudo guardar.');
  };
  const create = async () => {
    setBusy(true);
    const r = await createRoomAssessment(sessionId, newName, Number(newW.replace(',', '.')), true);
    setBusy(false);
    if (r.ok && r.id) { setAid(r.id); say('Evaluación creada.'); load(); } else say(r.error ?? 'No se pudo crear.');
  };
  const launch = (i: EvalItem) => {
    if (!i.open) return say('Esa evaluación no está abierta ahora: revise su fecha de apertura y cierre.');
    onLaunch({ id: i.id, kind: i.kind, title: i.title, section: d.sectionId! });
    say(`📣 «${i.title}» enviada a todos los estudiantes.`);
  };
  return (
    <div className="flex min-h-0 flex-1 flex-col text-sm" data-testid="panel-evaluacion">
      <div className="flex border-b border-white/10 text-xs">
        {([['calificar', '✍ Calificar'], ['lanzar', '📣 Evaluar ahora']] as const).map(([k, l]) => (
          <button key={k} className={`flex-1 py-2 font-semibold ${tab === k ? 'border-b-2 border-blue-500 text-white' : 'opacity-60'}`} onClick={() => setTab(k)} data-testid={`eval-tab-${k}`}>{l}</button>))}
      </div>
      {tab === 'lanzar' ? (
        <div className="flex-1 space-y-2 overflow-y-auto p-3">
          <p className="text-xs opacity-75">Envíe un examen o evaluación a toda la clase: a cada estudiante le aparece un aviso con el botón «Rendir ahora».</p>
          {items.length ? items.map((i) => (
            <div key={i.kind + i.id} className="flex items-center justify-between gap-2 rounded-lg bg-white/5 px-3 py-2">
              <span className="min-w-0"><span className="block truncate font-semibold">{i.kind === 'quiz' ? '✅' : '🔗'} {i.title}</span>
                <span className={`text-[11px] ${i.open ? 'text-emerald-300' : 'opacity-60'}`}>{i.open ? 'Abierta' : 'No disponible ahora'}</span></span>
              <button className="shrink-0 rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold hover:bg-blue-500 disabled:opacity-40" disabled={!i.open} onClick={() => launch(i)} data-testid="lanzar-evaluacion">Enviar a todos</button>
            </div>)) : <p className="opacity-70">No hay exámenes. Créelos en el aula del curso (pestaña Exámenes).</p>}
          <a className="block pt-2 text-center text-xs underline opacity-80" href={`/app/aula/${d.sectionId}?t=examenes`} target="_blank" rel="noopener noreferrer">+ Crear examen ↗</a>
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="space-y-2 border-b border-white/10 p-3">
            {d.assessments?.length ? (
              <select value={aid} onChange={(e) => setAid(e.target.value)} className="w-full rounded-lg bg-white/10 px-2 py-2 text-sm" data-testid="eval-evaluacion">
                {d.assessments.map((a) => <option key={a.id} value={a.id} className="text-black">{a.name} · {fmt(a.weight_pct, 0)} %{a.published ? '' : ' (oculta)'}</option>)}
              </select>) : <p className="text-xs opacity-75">Esta asignatura aún no tiene evaluaciones. Cree una:</p>}
            <details className="text-xs" open={!d.assessments?.length}>
              <summary className="cursor-pointer opacity-80">+ Nueva evaluación</summary>
              <div className="mt-2 flex gap-2">
                <input value={newName} onChange={(e) => setNewName(e.target.value)} className="min-w-0 flex-1 rounded bg-white/10 px-2 py-1.5" placeholder="Nombre" data-testid="eval-nueva-nombre" />
                <input value={newW} onChange={(e) => setNewW(e.target.value)} className="w-14 rounded bg-white/10 px-2 py-1.5 text-center" inputMode="decimal" aria-label="Ponderación %" />
                <button className="rounded bg-white/15 px-2 hover:bg-white/25" onClick={create} disabled={busy} data-testid="eval-crear">Crear</button>
              </div>
            </details>
            <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={onlyHere} onChange={(e) => setOnlyHere(e.target.checked)} /> Solo estudiantes conectados ahora</label>
          </div>
          <ul className="flex-1 space-y-1 overflow-y-auto p-3">
            {students.length ? students.map((s) => (
              <li key={s.id} className="flex items-center justify-between gap-2 rounded bg-white/5 px-2 py-1.5">
                <span className="min-w-0 truncate text-xs">{s.user_id && here.has(s.user_id) ? '🟢 ' : '⚪ '}{s.name}</span>
                <input value={vals[s.id] ?? ''} onChange={(e) => setVals((v) => ({ ...v, [s.id]: e.target.value }))} inputMode="decimal" disabled={d.closed || !aid}
                  className="w-16 rounded bg-white/10 px-2 py-1 text-center" aria-label={`Nota ${s.name}`} data-testid="eval-nota" placeholder={`${d.scale?.min}–${d.scale?.max}`} />
              </li>)) : <li className="text-xs opacity-70">{onlyHere ? 'Ningún estudiante inscrito está conectado. Desmarque «Solo conectados» para ver a todos.' : 'No hay estudiantes inscritos.'}</li>}
          </ul>
          <div className="space-y-2 border-t border-white/10 p-3">
            {d.closed && <p className="text-xs text-amber-300">El acta está cerrada: solo lectura.</p>}
            <button className="w-full rounded-lg bg-blue-600 py-2 font-semibold hover:bg-blue-500 disabled:opacity-40" onClick={save} disabled={busy || d.closed || !aid} data-testid="eval-guardar">{busy ? 'Guardando…' : 'Guardar notas'}</button>
            <a className="block text-center text-xs underline opacity-80" href={full} target="_blank" rel="noopener noreferrer">Abrir el libro de notas completo ↗</a>
          </div>
        </div>
      )}
    </div>
  );
}
