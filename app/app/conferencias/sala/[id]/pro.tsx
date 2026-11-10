'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useDataChannel, useLocalParticipant, useRoomContext, type TrackReferenceOrPlaceholder } from '@livekit/components-react';
import { RoomEvent, type Participant, type RemoteParticipant } from 'livekit-client';
import { admitWaiting, getAulaControls, getWaiting, setAulaControls, type Waiting } from '@/app/app/conferencias/aula-actions';
import type { Conn } from '@/components/conference/context';

const enc = new TextEncoder(), dec = new TextDecoder();
type Ctrl = { t: 'timer'; ends: number; label: string } | { t: 'timer-stop' } | { t: 'spot'; identity: string | null } | { t: 'cc'; on: boolean };

/** Controles compartidos por el anfitrión: temporizador, destacar a una persona y subtítulos para todos. */
export function useControls(mod: boolean) {
  const room = useRoomContext();
  const [timer, setTimer] = useState<{ ends: number; label: string } | null>(null);
  const [spot, setSpot] = useState<string | null>(null);
  const [ccAll, setCcAll] = useState(false);
  const state = useRef({ timer, spot, ccAll }); state.current = { timer, spot, ccAll };
  const onMsg = useCallback((m: { payload: Uint8Array }) => {
    let d: Ctrl; try { d = JSON.parse(dec.decode(m.payload)); } catch { return; }
    if (d.t === 'timer') setTimer({ ends: d.ends, label: d.label }); else if (d.t === 'timer-stop') setTimer(null);
    else if (d.t === 'spot') setSpot(d.identity); else if (d.t === 'cc') setCcAll(d.on);
  }, []);
  const { send } = useDataChannel('control', onMsg);
  const post = useCallback((d: Ctrl, to?: string[]) => send(enc.encode(JSON.stringify(d)), { reliable: true, destinationIdentities: to }).catch(() => {}), [send]);
  // Quien llega tarde recibe el estado actual
  useEffect(() => {
    if (!mod) return;
    const f = (p: RemoteParticipant) => setTimeout(() => {
      const st = state.current;
      if (st.timer) post({ t: 'timer', ...st.timer }, [p.identity]);
      if (st.spot) post({ t: 'spot', identity: st.spot }, [p.identity]);
      if (st.ccAll) post({ t: 'cc', on: true }, [p.identity]);
    }, 1500);
    room.on(RoomEvent.ParticipantConnected, f);
    return () => { room.off(RoomEvent.ParticipantConnected, f); };
  }, [room, mod, post]);
  return {
    timer, spot, ccAll,
    startTimer: (min: number, label: string) => { const t = { ends: Date.now() + min * 60000, label }; setTimer(t); post({ t: 'timer', ...t }); },
    stopTimer: () => { setTimer(null); post({ t: 'timer-stop' }); },
    spotlight: (identity: string | null) => { setSpot(identity); post({ t: 'spot', identity }); },
    setCc: (on: boolean) => { setCcAll(on); post({ t: 'cc', on }); },
  };
}
export type Controls = ReturnType<typeof useControls>;

/** ⏱ Cuenta regresiva visible para todos. */
export function TimerChip({ timer, onEnd }: { timer: { ends: number; label: string } | null; onEnd?: () => void }) {
  const [now, setNow] = useState(Date.now());
  const fired = useRef(false);
  useEffect(() => { fired.current = false; }, [timer?.ends]);
  useEffect(() => { if (!timer) return; const i = setInterval(() => setNow(Date.now()), 500); return () => clearInterval(i); }, [timer]);
  if (!timer) return null;
  const left = Math.max(0, Math.round((timer.ends - now) / 1000));
  if (left === 0 && !fired.current) {
    fired.current = true; onEnd?.();
    try { const a = new AudioContext(); const o = a.createOscillator(); o.frequency.value = 880; o.connect(a.destination); o.start(); setTimeout(() => { o.stop(); a.close(); }, 500); } catch { /* */ }
  }
  return (
    <span className={`rounded px-2 py-0.5 font-mono text-xs font-bold ${left <= 30 ? 'animate-pulse bg-red-600' : 'bg-amber-500 text-black'}`} data-testid="temporizador">
      ⏱ {timer.label ? `${timer.label} · ` : ''}{left === 0 ? '¡Tiempo!' : `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`}
    </span>
  );
}

// ---------- Subtítulos en vivo ----------
type Cap = { id: string; who: string; text: string; final: boolean; at: number };
/** 💬 Subtítulos en vivo: cada persona transcribe su propio micrófono (Chrome/Edge) y lo comparte con todos. */
export function useCaptions(forceOn: boolean) {
  const { localParticipant } = useLocalParticipant();
  const [mine, setMine] = useState(false);       // transcribir mi voz
  const [show, setShow] = useState(false);       // ver subtítulos
  const [lines, setLines] = useState<Cap[]>([]);
  const transcript = useRef<string[]>([]);
  const rec = useRef<any>(null);
  const supported = typeof window !== 'undefined' && !!((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition);
  const onMsg = useCallback((m: { payload: Uint8Array; from?: Participant }) => {
    let d: { text: string; final: boolean; id: string }; try { d = JSON.parse(dec.decode(m.payload)); } catch { return; }
    add({ id: `${m.from?.identity}-${d.id}`, who: m.from?.name ?? 'Participante', text: String(d.text).slice(0, 300), final: !!d.final, at: Date.now() });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const { send } = useDataChannel('subtitulos', onMsg);
  const add = (c: Cap) => {
    setLines((l) => [...l.filter((x) => x.id !== c.id && Date.now() - x.at < 12000), c].slice(-4));
    if (c.final) transcript.current.push(`[${new Date().toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' })}] ${c.who}: ${c.text}`);
  };
  useEffect(() => { if (forceOn) { setShow(true); if (supported && localParticipant.isMicrophoneEnabled) setMine(true); } }, [forceOn]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!mine || !supported) return;
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    const r = new SR(); r.lang = 'es-CL'; r.continuous = true; r.interimResults = true; rec.current = r;
    let seq = 0, stop = false;
    r.onresult = (e: any) => {
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const text = e.results[i][0].transcript.trim(); if (!text) continue;
        const final = e.results[i].isFinal; const id = String(seq); if (final) seq++;
        add({ id: `yo-${id}`, who: localParticipant.name ?? 'Yo', text, final, at: Date.now() });
        send(enc.encode(JSON.stringify({ text, final, id })), { reliable: final }).catch(() => {});
      }
    };
    r.onend = () => { if (!stop) try { r.start(); } catch { /* */ } };
    try { r.start(); } catch { /* */ }
    return () => { stop = true; try { r.stop(); } catch { /* */ } };
  }, [mine, supported]); // eslint-disable-line react-hooks/exhaustive-deps
  const download = (title: string) => {
    const blob = new Blob([`Transcripción · ${title}\n${new Date().toLocaleString('es-CL')}\n\n${transcript.current.join('\n') || '(sin texto)'}\n`], { type: 'text/plain;charset=utf-8' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `Transcripcion - ${title}.txt`.replace(/[\\/:*?"<>|]/g, '-'); a.click();
  };
  return { supported, mine, setMine, show, setShow, lines, download, count: () => transcript.current.length };
}
export type Captions = ReturnType<typeof useCaptions>;

export function CaptionsOverlay({ cc }: { cc: Captions }) {
  if (!cc.show || !cc.lines.length) return null;
  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-3 z-20 flex flex-col items-center gap-1 px-4" data-testid="subtitulos" aria-live="polite">
      {cc.lines.map((l) => <p key={l.id} className="max-w-3xl rounded-lg bg-black/75 px-3 py-1 text-center text-base"><b className="text-amber-300">{l.who}:</b> {l.text}</p>)}
    </div>
  );
}

// ---------- Panel del anfitrión ----------
export function HostPanel({ sessionId, title, controls, cc, say }: { sessionId: string; title: string; controls: Controls; cc: Captions; say: (m: string) => void }) {
  const [st, setSt] = useState<{ waiting_room: boolean; locked: boolean } | null>(null);
  const [waiting, setWaiting] = useState<Waiting[]>([]);
  const [min, setMin] = useState('5'); const [label, setLabel] = useState('');
  const load = useCallback(async () => { const [c, w] = await Promise.all([getAulaControls(sessionId), getWaiting(sessionId)]); if (c) setSt(c); setWaiting(w); }, [sessionId]);
  useEffect(() => { load(); const i = setInterval(load, 4000); return () => clearInterval(i); }, [load]);
  const toggle = async (k: 'waiting' | 'locked') => {
    const r = await setAulaControls(sessionId, k === 'waiting' ? !st?.waiting_room : null, k === 'locked' ? !st?.locked : null);
    if (!r.ok) say((r as any).error ?? 'No se pudo cambiar.'); await load();
  };
  const admit = async (ids: string[] | null, yes: boolean) => { await admitWaiting(sessionId, ids, yes); await load(); };
  const row = 'flex items-center justify-between gap-2 rounded-lg bg-white/5 px-3 py-2';
  return (
    <div className="flex-1 space-y-4 overflow-y-auto p-3 text-sm" data-testid="panel-anfitrion">
      <section className="space-y-2">
        <p className="text-xs font-bold uppercase opacity-60">Acceso</p>
        <label className={row}><span>⏳ Sala de espera <span className="block text-[11px] opacity-60">Usted admite a cada persona</span></span>
          <input type="checkbox" checked={!!st?.waiting_room} onChange={() => toggle('waiting')} data-testid="toggle-espera" /></label>
        <label className={row}><span>🔒 Bloquear sala <span className="block text-[11px] opacity-60">Nadie más puede entrar</span></span>
          <input type="checkbox" checked={!!st?.locked} onChange={() => toggle('locked')} data-testid="toggle-bloqueo" /></label>
        {waiting.length > 0 && (
          <div className="rounded-lg border border-amber-400/40 p-2" data-testid="lista-espera">
            <div className="mb-1 flex items-center justify-between"><b>En espera ({waiting.length})</b>
              <button className="rounded bg-emerald-600 px-2 py-0.5 text-xs" onClick={() => admit(null, true)}>Admitir a todos</button></div>
            {waiting.map((w) => (
              <div key={w.id} className="flex items-center justify-between gap-2 py-1">
                <span className="truncate">{w.name}</span>
                <span className="flex shrink-0 gap-1">
                  <button className="rounded bg-emerald-600 px-2 py-0.5 text-xs" onClick={() => admit([w.id], true)} data-testid="admitir">Admitir</button>
                  <button className="rounded bg-white/10 px-2 py-0.5 text-xs" onClick={() => admit([w.id], false)}>Rechazar</button>
                </span>
              </div>))}
          </div>)}
      </section>
      <section className="space-y-2">
        <p className="text-xs font-bold uppercase opacity-60">⏱ Temporizador para todos</p>
        {controls.timer ? <button className="w-full rounded-lg bg-white/10 py-2" onClick={controls.stopTimer}>⏹ Detener temporizador</button> : (
          <div className="flex gap-1">
            <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Ej.: Trabajo en grupo" maxLength={40} className="min-w-0 flex-1 rounded-lg bg-white/10 px-2 py-1.5" />
            <select value={min} onChange={(e) => setMin(e.target.value)} className="rounded-lg bg-white/10 px-1">{[1, 2, 3, 5, 10, 15, 20, 30, 45, 60].map((m) => <option key={m} value={m} className="text-black">{m} min</option>)}</select>
            <button className="rounded-lg bg-blue-600 px-3" onClick={() => controls.startTimer(Number(min), label.trim())} data-testid="iniciar-temporizador">Iniciar</button>
          </div>)}
      </section>
      <section className="space-y-2">
        <p className="text-xs font-bold uppercase opacity-60">💬 Subtítulos en vivo</p>
        <label className={row}><span>Activar subtítulos para todos</span><input type="checkbox" checked={controls.ccAll} onChange={(e) => controls.setCc(e.target.checked)} data-testid="cc-todos" /></label>
        <button className="w-full rounded-lg bg-white/10 py-2" onClick={() => cc.download(title)}>⬇ Descargar transcripción ({cc.count()} líneas)</button>
      </section>
      {controls.spot && <button className="w-full rounded-lg bg-white/10 py-2" onClick={() => controls.spotlight(null)}>⭐ Quitar destacado para todos</button>}
    </div>
  );
}

/** 👥 Salas de grupos (repartir, abrir, mensaje a todos, visitar, cerrar). */
export function GroupsPanel({ sessionId, people, me, say, onVisit }: {
  sessionId: string; people: { identity: string; name: string; mod: boolean }[]; me: string; say: (m: string) => void; onVisit: (conn: Conn, group: number) => void;
}) {
  const [n, setN] = useState(2);
  const [assign, setAssign] = useState<Record<string, number>>({});
  const [open, setOpen] = useState(0);
  const [text, setText] = useState('');
  const others = people.filter((p) => p.identity !== me && !p.mod);
  useEffect(() => { getAulaControls(sessionId).then((c) => setOpen(c?.breakout_groups ?? 0)); }, [sessionId]);
  const auto = () => { const a: Record<string, number> = {}; [...others].sort(() => Math.random() - 0.5).forEach((p, i) => { a[p.identity] = (i % n) + 1; }); setAssign(a); };
  const call = async (body: object) => {
    const r = await fetch('/api/livekit/grupos', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ session: sessionId, ...body }) });
    const j = await r.json().catch(() => ({})); if (!r.ok) say(j.error ?? 'No se pudo.'); return r.ok ? j : null;
  };
  return (
    <div className="flex-1 space-y-3 overflow-y-auto p-3 text-sm" data-testid="panel-grupos">
      {open > 0 ? (<>
        <p className="rounded-lg bg-emerald-600/30 p-2">🟢 {open} grupo(s) abiertos. Usted sigue en la sala principal.</p>
        <div className="flex gap-1"><input value={text} onChange={(e) => setText(e.target.value)} placeholder="Mensaje para todos los grupos" className="min-w-0 flex-1 rounded-lg bg-white/10 px-2 py-1.5" />
          <button className="rounded-lg bg-blue-600 px-3" onClick={async () => { if (await call({ action: 'message', text })) { setText(''); say('Mensaje enviado a los grupos.'); } }}>Enviar</button></div>
        <div className="grid grid-cols-2 gap-1">{Array.from({ length: open }, (_, i) => (
          <button key={i} className="rounded-lg bg-white/10 py-2" onClick={async () => { const j = await call({ action: 'visit', group: i + 1 }); if (j) onVisit(j, i + 1); }}>👀 Visitar grupo {i + 1}</button>))}</div>
        <button className="w-full rounded-lg bg-red-600 py-2 font-semibold" data-testid="cerrar-grupos" onClick={async () => { if (await call({ action: 'end' })) { setOpen(0); setAssign({}); say('Todos vuelven a la sala principal.'); } }}>⏹ Cerrar grupos (todos vuelven)</button>
      </>) : (<>
        <p className="text-xs opacity-80">Reparta a los participantes en salas pequeñas para trabajar en grupo. Usted puede visitarlas y luego hacer volver a todos.</p>
        <div className="flex items-center gap-2"><span>Cantidad de grupos</span>
          <input type="number" min={1} max={20} value={n} onChange={(e) => setN(Math.max(1, Math.min(20, Number(e.target.value) || 1)))} className="w-16 rounded-lg bg-white/10 px-2 py-1" />
          <button className="rounded-lg bg-white/10 px-3 py-1" onClick={auto} data-testid="repartir">🔀 Repartir</button></div>
        <ul className="space-y-1">{others.map((p) => (
          <li key={p.identity} className="flex items-center justify-between gap-2"><span className="truncate">{p.name}</span>
            <select value={assign[p.identity] ?? 0} onChange={(e) => setAssign({ ...assign, [p.identity]: Number(e.target.value) })} className="rounded bg-white/10 px-1 text-xs" aria-label={`Grupo de ${p.name}`}>
              <option value={0} className="text-black">Sala principal</option>{Array.from({ length: n }, (_, i) => <option key={i} value={i + 1} className="text-black">Grupo {i + 1}</option>)}</select></li>))}
          {!others.length && <li className="opacity-60">Aún no hay participantes para repartir.</li>}</ul>
        <button className="w-full rounded-lg bg-blue-600 py-2 font-semibold disabled:opacity-40" disabled={!Object.values(assign).some((g) => g > 0)} data-testid="abrir-grupos"
          onClick={async () => { const groups = Object.fromEntries(Object.entries(assign).filter(([, g]) => g > 0)); const j = await call({ action: 'open', groups }); if (j) { setOpen(j.groups); say(`Grupos abiertos: ${j.sent} persona(s) enviadas.`); } }}>▶ Abrir grupos</button>
      </>)}
    </div>
  );
}

/** Mensajes del servidor para los grupos: ir a un grupo, volver a la principal o leer un mensaje del anfitrión. */
export function useGroupsChannel(onGo: (conn: Conn, group: number) => void, onBack: () => void, say: (m: string) => void) {
  const cb = useRef({ onGo, onBack, say }); cb.current = { onGo, onBack, say };
  useDataChannel('grupos', (m) => {
    let d: any; try { d = JSON.parse(dec.decode(m.payload)); } catch { return; }
    if (d.t === 'go' && d.token) cb.current.onGo({ token: d.token, url: d.url, role: 'attendee', moderator: false }, Number(d.group));
    else if (d.t === 'back') cb.current.onBack();
    else if (d.t === 'msg') cb.current.say(`📣 Anfitrión: ${String(d.text).slice(0, 300)}`);
  });
}

export const spotTrack = (tracks: TrackReferenceOrPlaceholder[], spot: string | null) =>
  spot ? tracks.find((t) => t.participant.identity === spot && String(t.source) === 'screen_share') ?? tracks.find((t) => t.participant.identity === spot) : undefined;
