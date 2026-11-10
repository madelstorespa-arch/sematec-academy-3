'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useDataChannel, useLocalParticipant, useRoomContext } from '@livekit/components-react';
import { RoomEvent, type RemoteParticipant } from 'livekit-client';

/** 📊 Encuestas rápidas en vivo: el anfitrión pregunta, todos votan y ven los resultados al instante. */
type Poll = { id: string; q: string; opts: string[]; open: boolean; showAll: boolean; anon: boolean };
type Msg = { t: 'poll'; poll: Poll; counts?: number[] } | { t: 'vote'; id: string; i: number; name: string } | { t: 'results'; id: string; counts: number[]; open: boolean };
const enc = new TextEncoder(), dec = new TextDecoder();

export function usePolls(mod: boolean) {
  const room = useRoomContext();
  const { localParticipant } = useLocalParticipant();
  const [poll, setPoll] = useState<Poll | null>(null);
  const [votes, setVotes] = useState<Record<string, { i: number; name: string }>>({}); // solo el anfitrión
  const [counts, setCounts] = useState<number[]>([]);
  const [myVote, setMyVote] = useState<number | null>(null);
  const [dismissed, setDismissed] = useState<string | null>(null);
  const pollRef = useRef(poll); pollRef.current = poll;

  const onMsg = useCallback((m: { payload: Uint8Array; from?: { identity: string } }) => {
    let d: Msg; try { d = JSON.parse(dec.decode(m.payload)); } catch { return; }
    if (d.t === 'poll') {
      setPoll((cur) => { if (cur?.id !== d.poll.id) { setMyVote(null); setDismissed(null); } return d.poll; });
      if (d.counts) setCounts(d.counts);
    } else if (d.t === 'vote' && mod && pollRef.current?.id === d.id && pollRef.current.open && m.from?.identity) {
      const from = m.from.identity;
      setVotes((v) => ({ ...v, [from]: { i: d.i, name: d.name } }));
    } else if (d.t === 'results') {
      setCounts(d.counts); setPoll((cur) => (cur && cur.id === d.id ? { ...cur, open: d.open, showAll: true } : cur));
    }
  }, [mod]);
  const { send } = useDataChannel('encuesta', onMsg);
  const post = useCallback((d: Msg, to?: string[]) => send(enc.encode(JSON.stringify(d)), { reliable: true, destinationIdentities: to }).catch(() => {}), [send]);

  // El anfitrión recalcula el conteo con cada voto (un voto por persona; puede cambiarlo)
  useEffect(() => {
    if (!mod || !poll) return;
    const c = poll.opts.map(() => 0); Object.values(votes).forEach((v) => { if (c[v.i] !== undefined) c[v.i]++; });
    setCounts(c);
    if (poll.showAll) post({ t: 'results', id: poll.id, counts: c, open: poll.open });
  }, [votes, poll, mod, post]);

  // Quien entra tarde recibe la encuesta abierta
  useEffect(() => {
    if (!mod) return;
    const f = (p: RemoteParticipant) => { const cur = pollRef.current; if (cur?.open) setTimeout(() => post({ t: 'poll', poll: cur }, [p.identity]), 1500); };
    room.on(RoomEvent.ParticipantConnected, f);
    return () => { room.off(RoomEvent.ParticipantConnected, f); };
  }, [room, mod, post]);

  return {
    poll, counts, votes, myVote, mod, hidden: dismissed === poll?.id,
    dismiss: () => setDismissed(poll?.id ?? null),
    launch: (q: string, opts: string[], anon: boolean) => {
      const p: Poll = { id: crypto.randomUUID(), q, opts, open: true, showAll: false, anon };
      setVotes({}); setCounts(opts.map(() => 0)); setMyVote(null); setPoll(p); post({ t: 'poll', poll: p });
    },
    vote: (i: number) => {
      if (!poll?.open) return;
      setMyVote(i);
      if (mod) setVotes((v) => ({ ...v, [localParticipant.identity]: { i, name: localParticipant.name ?? '' } }));
      else {
        const hosts = [...room.remoteParticipants.values()].filter((p) => { try { return ['organizer', 'moderator', 'teacher'].includes(JSON.parse(p.metadata || '{}').role); } catch { return false; } }).map((p) => p.identity);
        post({ t: 'vote', id: poll.id, i, name: localParticipant.name ?? '' }, hosts.length ? hosts : undefined);
      }
    },
    share: () => { if (!poll) return; const p = { ...poll, showAll: true }; setPoll(p); post({ t: 'poll', poll: p, counts }); post({ t: 'results', id: p.id, counts, open: p.open }); },
    close: () => { if (!poll) return; const p = { ...poll, open: false, showAll: true }; setPoll(p); post({ t: 'poll', poll: p, counts }); post({ t: 'results', id: p.id, counts, open: false }); },
    reset: () => setPoll(null),
  };
}
export type Polls = ReturnType<typeof usePolls>;

function Bars({ opts, counts, mine }: { opts: string[]; counts: number[]; mine?: number | null }) {
  const total = counts.reduce((a, b) => a + b, 0);
  return (
    <ul className="space-y-2" data-testid="encuesta-resultados">
      {opts.map((o, i) => {
        const n = counts[i] ?? 0; const pct = total ? Math.round((n / total) * 100) : 0;
        return (
          <li key={i}>
            <div className="flex justify-between text-xs"><span>{o}{mine === i && ' ✓'}</span><span>{n} · {pct}%</span></div>
            <div className="mt-1 h-2 overflow-hidden rounded bg-white/10"><div className="h-full rounded bg-blue-500 transition-all" style={{ width: `${pct}%` }} /></div>
          </li>);
      })}
      <li className="text-right text-[11px] opacity-60">{total} voto(s)</li>
    </ul>
  );
}

/** Panel del anfitrión: crear la encuesta y ver resultados en vivo. */
export function PollPanel({ polls }: { polls: Polls }) {
  const [q, setQ] = useState('');
  const [opts, setOpts] = useState(['', '']);
  const [anon, setAnon] = useState(true);
  const p = polls.poll;
  if (p) return (
    <div className="flex-1 overflow-y-auto p-3 text-sm" data-testid="encuesta-panel">
      <p className="font-semibold">{p.q}</p>
      <p className="mb-3 text-xs opacity-60">{p.open ? '🟢 Votación abierta' : '🔒 Votación cerrada'}{p.showAll ? ' · resultados visibles para todos' : ' · solo usted ve los resultados'}</p>
      <Bars opts={p.opts} counts={polls.counts} />
      {!p.anon && Object.keys(polls.votes).length > 0 && (
        <details className="mt-3 text-xs"><summary className="cursor-pointer opacity-80">Ver quién votó qué</summary>
          <ul className="mt-1 space-y-0.5">{Object.values(polls.votes).map((v, i) => <li key={i}>{v.name}: {p.opts[v.i]}</li>)}</ul></details>)}
      <div className="mt-4 flex flex-wrap gap-2">
        {!p.showAll && <button className="rounded-lg bg-white/10 px-3 py-1.5 hover:bg-white/20" onClick={polls.share}>👁 Mostrar resultados a todos</button>}
        {p.open && <button className="rounded-lg bg-white/10 px-3 py-1.5 hover:bg-white/20" onClick={polls.close} data-testid="encuesta-cerrar">🔒 Cerrar votación</button>}
        <button className="rounded-lg bg-blue-600 px-3 py-1.5" onClick={polls.reset}>➕ Nueva encuesta</button>
      </div>
    </div>
  );
  const valid = q.trim().length > 2 && opts.filter((o) => o.trim()).length >= 2;
  return (
    <form className="flex-1 space-y-2 overflow-y-auto p-3 text-sm" data-testid="encuesta-panel"
      onSubmit={(e) => { e.preventDefault(); if (valid) polls.launch(q.trim(), opts.map((o) => o.trim()).filter(Boolean), anon); }}>
      <label className="block text-xs opacity-80">Pregunta
        <input className="mt-1 w-full rounded-lg bg-white/10 px-3 py-2 outline-none" value={q} maxLength={200} onChange={(e) => setQ(e.target.value)} placeholder="¿Quedó claro el tema de hoy?" name="pregunta" /></label>
      {opts.map((o, i) => (
        <div key={i} className="flex gap-1">
          <input className="min-w-0 flex-1 rounded-lg bg-white/10 px-3 py-2 outline-none" value={o} maxLength={80} name={`opcion${i}`}
            onChange={(e) => setOpts(opts.map((x, j) => (j === i ? e.target.value : x)))} placeholder={`Opción ${i + 1}`} />
          {opts.length > 2 && <button type="button" className="rounded px-2 hover:bg-white/10" onClick={() => setOpts(opts.filter((_, j) => j !== i))} aria-label="Quitar opción">✕</button>}
        </div>))}
      {opts.length < 6 && <button type="button" className="text-xs underline opacity-80" onClick={() => setOpts([...opts, ''])}>➕ Agregar opción</button>}
      <div className="flex gap-1 text-xs">
        {[['Sí', 'No'], ['Sí', 'No', 'Más o menos'], ['A', 'B', 'C', 'D']].map((t) => <button type="button" key={t.join()} className="rounded bg-white/10 px-2 py-1 hover:bg-white/20" onClick={() => setOpts(t)}>{t.join(' / ')}</button>)}
      </div>
      <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={anon} onChange={(e) => setAnon(e.target.checked)} /> Votación anónima</label>
      <button className="w-full rounded-lg bg-blue-600 py-2 font-semibold disabled:opacity-50" disabled={!valid}>📊 Lanzar encuesta</button>
    </form>
  );
}

/** Tarjeta que ven los participantes para votar. */
export function PollCard({ polls }: { polls: Polls }) {
  const p = polls.poll;
  if (!p || polls.mod || polls.hidden || (!p.open && !p.showAll)) return null;
  return (
    <div className="absolute right-3 top-3 z-20 w-[min(92vw,20rem)] rounded-xl bg-[#222]/95 p-4 text-sm shadow-2xl backdrop-blur" data-testid="encuesta-voto">
      <div className="mb-2 flex items-start justify-between gap-2"><b>📊 {p.q}</b><button onClick={polls.dismiss} className="rounded px-1 opacity-70 hover:bg-white/10" aria-label="Ocultar">✕</button></div>
      {p.open && <div className="space-y-1">{p.opts.map((o, i) => (
        <button key={i} onClick={() => polls.vote(i)} className={`w-full rounded-lg px-3 py-2 text-left ${polls.myVote === i ? 'bg-blue-600' : 'bg-white/10 hover:bg-white/20'}`}>{o}</button>))}</div>}
      {polls.myVote !== null && p.open && <p className="mt-2 text-xs opacity-70">✓ Voto registrado. Puede cambiarlo mientras la votación esté abierta.</p>}
      {p.showAll && <div className="mt-3"><Bars opts={p.opts} counts={polls.counts} mine={polls.myVote} /></div>}
      {!p.open && <p className="mt-2 text-xs opacity-70">🔒 Votación cerrada.</p>}
    </div>
  );
}
