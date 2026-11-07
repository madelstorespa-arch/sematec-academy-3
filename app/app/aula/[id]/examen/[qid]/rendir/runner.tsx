'use client';
import { useEffect, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { startQuiz, submitQuiz } from '../../../../actions';

type Q = { id: string; prompt: string; kind: 'unica' | 'multiple' | 'vf'; options: string[]; points: number };

export function StartQuiz({ quizId }: { quizId: string }) {
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();
  return (
    <div>
      <button className="btn-primary" disabled={pending} onClick={() => start(async () => {
        const fd = new FormData(); fd.set('quiz_id', quizId);
        const r = await startQuiz(fd);
        if (r.ok) router.refresh(); else setErr(r.error ?? 'Error');
      })}>{pending ? 'Iniciando…' : 'Comenzar examen'}</button>
      {err && <p className="mt-3 rounded-lg bg-red-50 p-3 text-sm text-red-700">{err}</p>}
    </div>
  );
}

export function QuizRunner({ attemptId, deadline, questions, back }: { attemptId: string; deadline: string; questions: Q[]; back: string }) {
  const [ans, setAns] = useState<Record<string, number[]>>({});
  const [left, setLeft] = useState(() => new Date(deadline).getTime() - Date.now());
  const [res, setRes] = useState<{ ok: boolean; message?: string; error?: string } | null>(null);
  const [pending, start] = useTransition();
  const sent = useRef(false);
  const router = useRouter();
  const send = () => {
    if (sent.current) return; sent.current = true;
    start(async () => {
      try { const r = await submitQuiz(attemptId, ans); setRes(r); if (!r.ok) sent.current = false; }
      catch { sent.current = false; setRes({ ok: false, error: 'Sin conexión: el examen NO se envió. Reintente.' }); }
    });
  };
  useEffect(() => {
    const t = setInterval(() => { const l = new Date(deadline).getTime() - Date.now(); setLeft(l); if (l <= 0) { clearInterval(t); send(); } }, 1000);
    return () => clearInterval(t);
  }); // eslint-disable-line react-hooks/exhaustive-deps
  if (res?.ok) return (
    <div className="card card-pad text-center"><p className="text-lg font-bold text-emerald-700">✓ {res.message}</p>
      <button className="btn-primary mt-4" onClick={() => router.push(back)}>Volver</button></div>);
  const mm = Math.max(0, Math.floor(left / 60000)), ss = Math.max(0, Math.floor((left % 60000) / 1000));
  const toggle = (q: Q, i: number) => setAns((a) => ({ ...a, [q.id]: q.kind === 'multiple' ? (a[q.id]?.includes(i) ? a[q.id].filter((x) => x !== i) : [...(a[q.id] ?? []), i]) : [i] }));
  return (
    <div className="space-y-4">
      <div className={`sticky top-2 z-10 rounded-lg p-3 text-center text-sm font-bold shadow ${left < 120000 ? 'bg-red-600 text-white' : 'bg-white'}`}>
        ⏱ Tiempo restante: {mm}:{String(ss).padStart(2, '0')} · Respondidas {Object.keys(ans).filter((k) => ans[k].length).length} de {questions.length}
      </div>
      {questions.map((q, n) => (
        <div key={q.id} className="card card-pad">
          <p className="font-semibold">{n + 1}. {q.prompt} <span className="text-xs font-normal text-slate-500">({q.points} pt{q.kind === 'multiple' ? ' · puede marcar varias' : ''})</span></p>
          <div className="mt-3 space-y-2">{q.options.map((o, i) => (
            <label key={i} className="flex cursor-pointer items-center gap-3 rounded-lg border border-slate-200 p-3 has-[:checked]:border-brand-600 has-[:checked]:bg-brand-50">
              <input type={q.kind === 'multiple' ? 'checkbox' : 'radio'} name={q.id} checked={!!ans[q.id]?.includes(i)} onChange={() => toggle(q, i)} />{o}
            </label>))}</div>
        </div>))}
      <button className="btn-primary w-full py-3" disabled={pending} onClick={() => { if (window.confirm('¿Enviar el examen? No podrá cambiar sus respuestas.')) send(); }}>
        {pending ? 'Enviando…' : 'Enviar examen'}</button>
      {res && !res.ok && <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{res.error}</p>}
    </div>
  );
}
