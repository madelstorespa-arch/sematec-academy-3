'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useDataChannel, useLocalParticipant, useRoomContext, MediaDeviceSelect, useConnectionQualityIndicator } from '@livekit/components-react';
import { ConnectionQuality, RoomEvent, Track, VideoQuality, type Participant, type RemoteParticipant, type LocalAudioTrack } from 'livekit-client';
import { getAttendance, getAulaControls, setRoomPolicy, type AttendanceRow } from '@/app/app/conferencias/aula-actions';

const enc = new TextEncoder(), dec = new TextDecoder();
const MODS = new Set(['organizer', 'moderator', 'teacher']);
export const roleOf = (p: Participant) => { try { return JSON.parse(p.metadata || '{}').role ?? ''; } catch { return ''; } };
export const isModP = (p: Participant) => MODS.has(roleOf(p));

// ---------------------------------------------------------------- Configuración de la sala
export type Policy = { mic?: boolean; camera?: boolean; share?: boolean; chat?: boolean; private_chat?: boolean; reactions?: boolean; rename?: boolean };
export const POLICY_ITEMS: [keyof Policy, string, string][] = [
  ['mic', '🎙 Los participantes pueden activar su micrófono', 'Si lo apaga, solo los anfitriones pueden hablar (modo conferencia).'],
  ['camera', '📷 Los participantes pueden encender su cámara', ''],
  ['share', '🖥 Los participantes pueden compartir pantalla', 'Sin marcar: solo los anfitriones (o a quien usted autorice en «Personas»).'],
  ['chat', '💬 Chat para todos', ''],
  ['private_chat', '✉ Mensajes privados entre participantes', 'Sin marcar: los participantes solo pueden escribir en privado a los anfitriones.'],
  ['reactions', '😀 Reacciones (emojis)', ''],
  ['rename', '✏ Los participantes pueden cambiar su nombre', ''],
];
const allowed = (p: Policy, k: keyof Policy) => p[k] !== false;

// ---------------------------------------------------------------- Ajustes personales (solo este equipo)
export type MySettings = { noise: boolean; echo: boolean; agc: boolean; mirror: boolean; quality: 'auto' | 'low' | 'audio'; hideNoVideo: boolean; wake: boolean; ptt: boolean; screenOnly: boolean };
const DEFAULTS: MySettings = { noise: true, echo: true, agc: true, mirror: true, quality: 'auto', hideNoVideo: false, wake: true, ptt: true, screenOnly: false };
export function useMySettings() {
  const [s, setS] = useState<MySettings>(DEFAULTS);
  useEffect(() => { try { setS({ ...DEFAULTS, ...JSON.parse(localStorage.getItem('sematec-aula-ajustes') ?? '{}') }); } catch { /* */ } }, []);
  const set = useCallback((p: Partial<MySettings>) => setS((cur) => { const n = { ...cur, ...p }; try { localStorage.setItem('sematec-aula-ajustes', JSON.stringify(n)); } catch { /* */ } return n; }), []);
  return [s, set] as const;
}

/** Aplica los ajustes: procesamiento de audio, calidad de video recibido (ahorro de datos) y pantalla siempre encendida. */
export function useApplySettings(s: MySettings) {
  const room = useRoomContext();
  // Micrófono: reducción de ruido, eco y volumen automático
  useEffect(() => {
    const opts = { noiseSuppression: s.noise, echoCancellation: s.echo, autoGainControl: s.agc };
    room.options.audioCaptureDefaults = { ...room.options.audioCaptureDefaults, ...opts };
    const t = room.localParticipant.getTrackPublication(Track.Source.Microphone)?.track as LocalAudioTrack | undefined;
    t?.restartTrack(opts).catch(() => {});
  }, [room, s.noise, s.echo, s.agc]);
  // Calidad del video que recibo
  useEffect(() => {
    const apply = () => {
      room.remoteParticipants.forEach((p: RemoteParticipant) => p.trackPublications.forEach((pub) => {
        if (pub.kind !== Track.Kind.Video) return;
        const screen = pub.source === Track.Source.ScreenShare;
        try {
          pub.setEnabled(s.quality !== 'audio' || screen);
          if (!screen) pub.setVideoQuality(s.quality === 'low' ? VideoQuality.LOW : VideoQuality.HIGH);
        } catch { /* aún no suscrito */ }
      }));
    };
    apply();
    room.on(RoomEvent.TrackSubscribed, apply).on(RoomEvent.TrackPublished, apply);
    return () => { room.off(RoomEvent.TrackSubscribed, apply).off(RoomEvent.TrackPublished, apply); };
  }, [room, s.quality]);
  // Pantalla siempre encendida mientras está en la clase
  useEffect(() => {
    if (!s.wake || !('wakeLock' in navigator)) return;
    let lock: any = null, stop = false;
    const req = async () => { try { if (document.visibilityState === 'visible' && !stop) lock = await (navigator as any).wakeLock.request('screen'); } catch { /* */ } };
    req(); const vis = () => req();
    document.addEventListener('visibilitychange', vis);
    return () => { stop = true; document.removeEventListener('visibilitychange', vis); lock?.release?.().catch(() => {}); };
  }, [s.wake]);
}

/** 📶 Calidad de mi conexión. */
export function ConnectionChip() {
  const { localParticipant } = useLocalParticipant();
  const { quality } = useConnectionQualityIndicator({ participant: localParticipant });
  const map: Record<string, [string, string]> = {
    [ConnectionQuality.Excellent]: ['📶', 'Conexión excelente'], [ConnectionQuality.Good]: ['📶', 'Conexión buena'],
    [ConnectionQuality.Poor]: ['⚠', 'Conexión débil: active «Ahorro de datos» en Herramientas → Mis ajustes'], [ConnectionQuality.Lost]: ['❌', 'Conexión perdida: reconectando…'],
  };
  const m = map[quality] ?? ['📶', 'Midiendo la conexión'];
  return <span className={`rounded px-1.5 py-0.5 text-[11px] ${quality === ConnectionQuality.Poor || quality === ConnectionQuality.Lost ? 'bg-amber-500 text-black' : 'bg-white/10'}`} title={m[1]} data-testid="conexion">{m[0]}<span className="hidden md:inline"> {m[1].split(':')[0]}</span></span>;
}

// ---------------------------------------------------------------- Estado compartido (notas, preguntas, apps, sorteo, privados)
export type QA = { id: string; text: string; by: string; anon: boolean; votes: string[]; answered: boolean; at: number };
export type DM = { id: string; from: string; fromName: string; to: string; toName: string; text: string; at: number };
type Msg =
  | { k: 'policy'; policy: Policy } | { k: 'notes'; text: string; at: number; locked?: boolean }
  | { k: 'q'; item: QA } | { k: 'vote'; id: string; who: string } | { k: 'answer'; id: string } | { k: 'qdel'; id: string }
  | { k: 'app'; app: { url: string; title: string } | null } | { k: 'link'; url: string; title: string; by: string }
  | { k: 'pick'; name: string } | { k: 'dm'; dm: DM }
  | { k: 'sync'; policy: Policy; notes: string; notesAt: number; locked: boolean; qa: QA[]; app: { url: string; title: string } | null };

export function useTools({ sessionId, mod, guest, say }: { sessionId: string; mod: boolean; guest?: boolean; say: (m: string) => void }) {
  const room = useRoomContext();
  const { localParticipant } = useLocalParticipant();
  const [policy, setPolicy] = useState<Policy>({});
  const [notes, setNotesState] = useState(''); const [notesAt, setNotesAt] = useState(0); const [locked, setLockedState] = useState(false);
  const [qa, setQa] = useState<QA[]>([]);
  const [app, setApp] = useState<{ url: string; title: string } | null>(null);
  const [link, setLink] = useState<{ url: string; title: string; by: string } | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  const [dms, setDms] = useState<DM[]>([]);
  const st = useRef({ policy, notes, notesAt, locked, qa, app }); st.current = { policy, notes, notesAt, locked, qa, app };
  const onMsg = useCallback((m: { payload: Uint8Array; from?: Participant }) => {
    let d: Msg; try { d = JSON.parse(dec.decode(m.payload)); } catch { return; }
    const fromMod = !!m.from && isModP(m.from);
    switch (d.k) {
      case 'policy': if (fromMod) setPolicy(d.policy); break;
      case 'notes': if (d.at > st.current.notesAt) { setNotesState(String(d.text).slice(0, 50000)); setNotesAt(d.at); } if (fromMod && d.locked !== undefined) setLockedState(!!d.locked); break;
      case 'q': setQa((l) => (l.some((x) => x.id === d.item.id) ? l : [...l, { ...d.item, text: String(d.item.text).slice(0, 500) }].slice(-200))); break;
      case 'vote': setQa((l) => l.map((x) => (x.id === d.id && !x.votes.includes(d.who) ? { ...x, votes: [...x.votes, d.who] } : x))); break;
      case 'answer': if (fromMod) setQa((l) => l.map((x) => (x.id === d.id ? { ...x, answered: true } : x))); break;
      case 'qdel': if (fromMod) setQa((l) => l.filter((x) => x.id !== d.id)); break;
      case 'app': if (fromMod) setApp(d.app && /^https:\/\//.test(d.app.url) ? d.app : null); break;
      case 'link': if (/^https?:\/\//.test(d.url)) { setLink(d); setTimeout(() => setLink((l) => (l?.url === d.url ? null : l)), 60000); } break;
      case 'pick': if (fromMod) { setPicked(d.name); setTimeout(() => setPicked(null), 7000); } break;
      case 'dm': setDms((l) => [...l, d.dm].slice(-200)); say(`✉ Mensaje privado de ${d.dm.fromName}: ${d.dm.text.slice(0, 80)}`); break;
      case 'sync': if (fromMod) { setPolicy(d.policy); if (d.notesAt > st.current.notesAt) { setNotesState(d.notes); setNotesAt(d.notesAt); } setLockedState(d.locked); setQa(d.qa ?? []); setApp(d.app); } break;
    }
  }, [say]);
  const { send } = useDataChannel('herramientas', onMsg);
  const post = useCallback((d: Msg, to?: string[]) => send(enc.encode(JSON.stringify(d)), { reliable: true, destinationIdentities: to }).catch(() => {}), [send]);

  // Configuración inicial guardada en la sesión y envío del estado a quien llega tarde
  useEffect(() => { if (!guest) getAulaControls(sessionId).then((c) => { if (c?.room_policy) setPolicy(c.room_policy as Policy); }); }, [sessionId, guest]);
  useEffect(() => {
    if (!mod) return;
    const f = (p: RemoteParticipant) => setTimeout(() => { const s = st.current; post({ k: 'sync', policy: s.policy, notes: s.notes, notesAt: s.notesAt, locked: s.locked, qa: s.qa, app: s.app }, [p.identity]); }, 1500);
    room.on(RoomEvent.ParticipantConnected, f);
    return () => { room.off(RoomEvent.ParticipantConnected, f); };
  }, [room, mod, post]);

  const me = localParticipant.identity, myName = localParticipant.name || 'Participante';
  const notesTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  return {
    policy, notes, locked, qa, app, link, picked, dms,
    can: (k: keyof Policy) => mod || allowed(policy, k),
    async savePolicy(p: Policy) {
      const r = await setRoomPolicy(sessionId, p as Record<string, boolean>);
      if (!r.ok) { say((r as any).error ?? 'No se pudo guardar.'); return false; }
      setPolicy((r as any).policy ?? p); post({ k: 'policy', policy: (r as any).policy ?? p });
      await fetch('/api/livekit/moderar', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ session: sessionId, action: 'apply_policy' }) }).catch(() => {});
      return true;
    },
    setNotes(text: string) {
      const at = Date.now(); setNotesState(text); setNotesAt(at);
      clearTimeout(notesTimer.current); notesTimer.current = setTimeout(() => post({ k: 'notes', text, at }), 400);
    },
    setLocked(v: boolean) { setLockedState(v); post({ k: 'notes', text: st.current.notes, at: st.current.notesAt, locked: v }); },
    ask(text: string, anon: boolean) {
      const item: QA = { id: `${me}-${Date.now()}`, text: text.trim().slice(0, 500), by: anon ? 'Anónimo' : myName, anon, votes: [], answered: false, at: Date.now() };
      setQa((l) => [...l, item]); post({ k: 'q', item });
    },
    vote(id: string) { setQa((l) => l.map((x) => (x.id === id && !x.votes.includes(me) ? { ...x, votes: [...x.votes, me] } : x))); post({ k: 'vote', id, who: me }); },
    answer(id: string) { setQa((l) => l.map((x) => (x.id === id ? { ...x, answered: true } : x))); post({ k: 'answer', id }); },
    removeQ(id: string) { setQa((l) => l.filter((x) => x.id !== id)); post({ k: 'qdel', id }); },
    shareApp(a: { url: string; title: string } | null) { setApp(a); post({ k: 'app', app: a }); },
    shareLink(url: string, title: string) { post({ k: 'link', url, title, by: myName }); say('🔗 Enlace enviado a todos.'); },
    pick(candidates: Participant[]) {
      if (!candidates.length) { say('No hay participantes para elegir.'); return; }
      const p = candidates[Math.floor(Math.random() * candidates.length)];
      const name = p.name || 'Participante'; setPicked(name); setTimeout(() => setPicked(null), 7000); post({ k: 'pick', name });
    },
    sendDM(to: Participant, text: string) {
      const dm: DM = { id: `${me}-${Date.now()}`, from: me, fromName: myName, to: to.identity, toName: to.name || 'Participante', text: text.trim().slice(0, 1000), at: Date.now() };
      setDms((l) => [...l, dm]); post({ k: 'dm', dm }, [to.identity]);
    },
  };
}
export type Tools = ReturnType<typeof useTools>;

// ---------------------------------------------------------------- Apps dentro de la clase
const EMBED_HOSTS = ['youtube.com', 'youtu.be', 'youtube-nocookie.com', 'vimeo.com', 'docs.google.com', 'drive.google.com', 'canva.com', 'genial.ly', 'geogebra.org',
  'desmos.com', 'phet.colorado.edu', 'padlet.com', 'forms.office.com', 'onedrive.live.com', 'mentimeter.com', 'menti.com', 'wordwall.net', 'scratch.mit.edu', 'loom.com', 'figma.com'];
export const APP_SUGGESTIONS: [string, string, string][] = [
  ['▶ YouTube', 'https://www.youtube.com/watch?v=', 'Pegue el enlace del video'], ['📊 Google Slides', 'https://docs.google.com/presentation/d/', 'Presentación compartida'],
  ['📄 Google Docs', 'https://docs.google.com/document/d/', 'Documento compartido'], ['📝 Google Forms', 'https://docs.google.com/forms/d/e/', 'Formulario o prueba'],
  ['🎨 Canva', 'https://www.canva.com/design/', 'Diseño publicado'], ['📐 GeoGebra', 'https://www.geogebra.org/calculator', 'Calculadora gráfica'],
  ['📈 Desmos', 'https://www.desmos.com/calculator', 'Calculadora gráfica'], ['🔬 PhET', 'https://phet.colorado.edu/es/simulations/', 'Simulaciones de ciencias'],
  ['🧱 Padlet', 'https://padlet.com/', 'Muro colaborativo'], ['🎮 Wordwall', 'https://wordwall.net/', 'Juegos educativos'],
];
/** Convierte un enlace normal en uno que se puede mostrar dentro de la clase (o null si el sitio no lo permite). */
export function toEmbed(raw: string): string | null {
  let u: URL; try { u = new URL(raw.trim().startsWith('http') ? raw.trim() : `https://${raw.trim()}`); } catch { return null; }
  const h = u.hostname.replace(/^www\./, '').replace(/^m\./, '');
  if (!EMBED_HOSTS.some((d) => h === d || h.endsWith(`.${d}`))) return null;
  u.protocol = 'https:';
  const yt = h === 'youtu.be' ? u.pathname.slice(1) : h.endsWith('youtube.com') ? (u.searchParams.get('v') ?? (u.pathname.match(/\/(embed|shorts|live)\/([\w-]{6,})/)?.[2] ?? '')) : '';
  if (yt && /^[\w-]{6,20}$/.test(yt)) return `https://www.youtube-nocookie.com/embed/${yt}?rel=0`;
  if (h === 'vimeo.com') { const id = u.pathname.match(/\/(\d{5,})/)?.[1]; return id ? `https://player.vimeo.com/video/${id}` : null; }
  if (h === 'docs.google.com') {
    const m = u.pathname.match(/^\/(document|presentation|spreadsheets|drawings)\/d\/([\w-]{10,})/);
    if (m) return `https://docs.google.com/${m[1]}/d/${m[2]}/${m[1] === 'presentation' ? 'embed?start=false&loop=false' : 'preview'}`;
    if (u.pathname.startsWith('/forms/')) { u.searchParams.set('embedded', 'true'); return u.toString().replace('/edit', '/viewform'); }
  }
  if (h === 'drive.google.com') { const id = u.pathname.match(/\/file\/d\/([\w-]{10,})/)?.[1]; return id ? `https://drive.google.com/file/d/${id}/preview` : null; }
  if (h === 'canva.com' && !u.searchParams.has('embed')) { u.searchParams.set('embed', ''); return u.toString(); }
  return u.toString();
}

export function AppStage({ tools, mod }: { tools: Tools; mod: boolean }) {
  const [hidden, setHidden] = useState(false);
  useEffect(() => { setHidden(false); }, [tools.app?.url]);
  if (!tools.app) return null;
  if (hidden) return (
    <button className="absolute left-1/2 top-2 z-20 -translate-x-1/2 rounded-full bg-indigo-600 px-3 py-1 text-xs shadow" onClick={() => setHidden(false)}>📱 Volver a «{tools.app.title}»</button>);
  return (
    <div className="absolute inset-0 z-[6] flex flex-col bg-[#111]" data-testid="app-en-clase">
      <div className="flex items-center justify-between gap-2 bg-indigo-700/60 px-3 py-1 text-xs">
        <span className="truncate">📱 {tools.app.title} <span className="opacity-70">· compartido en la clase</span></span>
        <span className="flex shrink-0 gap-1">
          <a className="rounded bg-white/15 px-2 py-0.5 hover:bg-white/25" href={tools.app.url} target="_blank" rel="noopener noreferrer">↗ Abrir aparte</a>
          <button className="rounded bg-white/15 px-2 py-0.5 hover:bg-white/25" onClick={() => setHidden(true)}>Ver videos</button>
          {mod && <button className="rounded bg-red-600/80 px-2 py-0.5 hover:bg-red-600" onClick={() => tools.shareApp(null)} data-testid="cerrar-app">Dejar de compartir</button>}
        </span>
      </div>
      <iframe src={tools.app.url} title={tools.app.title} className="min-h-0 flex-1 bg-white" allow="autoplay; fullscreen; clipboard-write; encrypted-media; picture-in-picture"
        sandbox="allow-scripts allow-same-origin allow-popups allow-forms allow-presentation" referrerPolicy="strict-origin-when-cross-origin" />
    </div>
  );
}

export function ToolBanners({ tools }: { tools: Tools }) {
  return (
    <>
      {tools.picked && <div className="pointer-events-none absolute left-1/2 top-1/3 z-30 -translate-x-1/2 animate-bounce rounded-2xl bg-amber-400 px-6 py-4 text-center text-2xl font-black text-black shadow-2xl" data-testid="elegido">🎲 ¡Le toca a {tools.picked}!</div>}
      {tools.link && (
        <div className="absolute left-1/2 top-2 z-30 flex max-w-[92%] -translate-x-1/2 items-center gap-2 rounded-xl bg-[#222] px-3 py-2 text-xs shadow-xl" data-testid="enlace-compartido">
          🔗 <span className="truncate">{tools.link.by} compartió: <b>{tools.link.title}</b></span>
          <a className="shrink-0 rounded bg-blue-600 px-2 py-1 font-semibold" href={tools.link.url} target="_blank" rel="noopener noreferrer">Abrir</a>
        </div>)}
    </>
  );
}

// ---------------------------------------------------------------- Paneles
const card = 'flex w-full items-start gap-3 rounded-xl bg-white/5 p-3 text-left hover:bg-white/10';
export type ToolPanel = 'notes' | 'qa' | 'apps' | 'attendance' | 'roomcfg' | 'mysettings';
export function ToolsHub({ mod, tools, open, onPick, onPip, participants }: { mod: boolean; tools: Tools; open: (p: ToolPanel) => void; onPick: () => void; onPip: () => void; participants: number }) {
  const pending = tools.qa.filter((q) => !q.answered).length;
  const items: [string, string, string, () => void, boolean][] = [
    ['🎛', 'Mis ajustes', 'Micrófono, cámara, parlante, ruido, calidad, ahorro de datos, nombre', () => open('mysettings'), true],
    ['📝', 'Notas compartidas', 'Apuntes de la clase que todos ven y pueden descargar', () => open('notes'), true],
    ['❓', `Preguntas y respuestas${pending ? ` (${pending})` : ''}`, 'Haga preguntas (también anónimas) y vote las de otros', () => open('qa'), true],
    ['📱', 'Apps y enlaces', 'YouTube, Google Docs/Slides/Forms, Canva, GeoGebra… dentro de la clase', () => open('apps'), true],
    ['⧉', 'Ventana flotante', 'Use otras apps de su equipo o celular sin salir de la clase', onPip, true],
    ['🎲', 'Elegir al azar', `Sortea a un participante entre ${participants} conectados`, onPick, mod],
    ['📋', 'Asistencia', 'Quién entró, cuándo y cuánto tiempo (descargable)', () => open('attendance'), mod],
    ['⚙', 'Configuración de la sala', 'Micrófonos, cámaras, pantalla, chat, privados, reacciones', () => open('roomcfg'), mod],
  ];
  return (
    <div className="flex-1 space-y-2 overflow-y-auto p-3 text-sm" data-testid="herramientas">
      {items.filter((i) => i[4]).map(([icon, t, d, fn]) => (
        <button key={t} className={card} onClick={fn}><span className="text-2xl">{icon}</span><span><b>{t}</b><span className="block text-xs opacity-70">{d}</span></span></button>))}
      <details className="rounded-xl bg-white/5 p-3 text-xs"><summary className="cursor-pointer font-semibold">⌨ Atajos de teclado</summary>
        <ul className="mt-2 space-y-1 opacity-80">
          <li><kbd>Ctrl</kbd>+<kbd>D</kbd> micrófono · <kbd>Ctrl</kbd>+<kbd>E</kbd> cámara</li>
          <li>Mantener <kbd>Espacio</kbd>: hablar mientras está silenciado</li>
          <li><kbd>Alt</kbd>+<kbd>Y</kbd> mano · <kbd>Alt</kbd>+<kbd>C</kbd> chat · <kbd>Alt</kbd>+<kbd>P</kbd> personas · <kbd>Alt</kbd>+<kbd>H</kbd> herramientas</li>
        </ul></details>
    </div>
  );
}

export function NotesPanel({ tools, mod, title }: { tools: Tools; mod: boolean; title: string }) {
  const canEdit = mod || !tools.locked;
  const download = () => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([`Notas · ${title}\n${new Date().toLocaleString('es-CL')}\n\n${tools.notes}`], { type: 'text/plain;charset=utf-8' }));
    a.download = `Notas - ${title}.txt`.replace(/[\\/:*?"<>|]/g, '-'); a.click();
  };
  return (
    <div className="flex flex-1 flex-col gap-2 p-3 text-sm" data-testid="notas">
      <textarea value={tools.notes} onChange={(e) => tools.setNotes(e.target.value.slice(0, 50000))} readOnly={!canEdit} data-testid="notas-texto"
        className="min-h-0 flex-1 resize-none rounded-lg bg-white/10 p-2 outline-none placeholder:text-white/40" placeholder={canEdit ? 'Escriba aquí: todos ven los cambios al instante…' : 'Solo el anfitrión puede escribir.'} />
      <div className="flex flex-wrap items-center gap-2">
        <button className="rounded-lg bg-white/10 px-3 py-1.5" onClick={download}>⬇ Descargar</button>
        {mod && <label className="flex items-center gap-1 text-xs"><input type="checkbox" checked={tools.locked} onChange={(e) => tools.setLocked(e.target.checked)} /> Solo el anfitrión escribe</label>}
      </div>
    </div>
  );
}

export function QAPanel({ tools, mod }: { tools: Tools; mod: boolean }) {
  const { localParticipant } = useLocalParticipant();
  const [text, setText] = useState(''); const [anon, setAnon] = useState(false);
  const list = [...tools.qa].sort((a, b) => Number(a.answered) - Number(b.answered) || b.votes.length - a.votes.length || a.at - b.at);
  return (
    <div className="flex flex-1 flex-col text-sm" data-testid="preguntas">
      <ul className="flex-1 space-y-2 overflow-y-auto p-3">
        {!list.length && <li className="text-center text-xs opacity-60">Aún no hay preguntas.</li>}
        {list.map((q) => (
          <li key={q.id} className={`rounded-lg p-2 ${q.answered ? 'bg-emerald-600/20 opacity-70' : 'bg-white/10'}`} data-testid="pregunta">
            <p className="whitespace-pre-wrap break-words">{q.text}</p>
            <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px]">
              <span className="opacity-60">{q.by}{q.answered && ' · ✓ respondida'}</span>
              <button className="rounded bg-white/10 px-2 py-0.5 disabled:opacity-50" disabled={q.votes.includes(localParticipant.identity)} onClick={() => tools.vote(q.id)} data-testid="votar">👍 {q.votes.length}</button>
              {mod && !q.answered && <button className="rounded bg-emerald-600/70 px-2 py-0.5" onClick={() => tools.answer(q.id)}>✓ Respondida</button>}
              {mod && <button className="rounded px-2 py-0.5 opacity-70 hover:bg-white/10" onClick={() => tools.removeQ(q.id)}>Quitar</button>}
            </div>
          </li>))}
      </ul>
      <form className="space-y-1 border-t border-white/10 p-2" onSubmit={(e) => { e.preventDefault(); if (text.trim()) { tools.ask(text, anon); setText(''); } }}>
        <textarea value={text} onChange={(e) => setText(e.target.value)} maxLength={500} rows={2} placeholder="Escriba su pregunta…" className="w-full rounded-lg bg-white/10 p-2 outline-none" aria-label="Pregunta" />
        <div className="flex items-center justify-between"><label className="flex items-center gap-1 text-xs"><input type="checkbox" checked={anon} onChange={(e) => setAnon(e.target.checked)} /> Anónima</label>
          <button className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold disabled:opacity-50" disabled={!text.trim()}>Preguntar</button></div>
      </form>
    </div>
  );
}

export function AppsPanel({ tools, mod, say }: { tools: Tools; mod: boolean; say: (m: string) => void }) {
  const [url, setUrl] = useState(''); const [title, setTitle] = useState('');
  const embed = url ? toEmbed(url) : null;
  const go = (forAll: boolean) => {
    const raw = url.trim(); if (!raw) return;
    const full = raw.startsWith('http') ? raw : `https://${raw}`;
    const name = title.trim() || (() => { try { return new URL(full).hostname.replace(/^www\./, ''); } catch { return 'App'; } })();
    if (forAll && mod) {
      if (embed) { tools.shareApp({ url: embed, title: name }); say('📱 App compartida dentro de la clase.'); }
      else tools.shareLink(full, name);
    } else window.open(embed ?? full, '_blank', 'noopener');
    setUrl(''); setTitle('');
  };
  return (
    <div className="flex-1 space-y-3 overflow-y-auto p-3 text-sm" data-testid="apps">
      <p className="text-xs opacity-80">{mod ? 'Pegue un enlace: si el sitio lo permite se abre DENTRO de la clase para todos; si no, todos reciben un botón para abrirlo.' : 'Abra una app o página en una pestaña nueva: la clase sigue conectada.'}</p>
      <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…" className="w-full rounded-lg bg-white/10 px-3 py-2 outline-none" aria-label="Enlace" data-testid="app-url" />
      <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Nombre (opcional)" maxLength={60} className="w-full rounded-lg bg-white/10 px-3 py-2 outline-none" />
      {url && <p className="text-xs">{embed ? '✅ Se puede mostrar dentro de la clase.' : 'ℹ Este sitio no permite mostrarse dentro de otra página: se enviará como enlace.'}</p>}
      <div className="flex flex-wrap gap-2">
        {mod && <button className="rounded-lg bg-blue-600 px-3 py-2 font-semibold disabled:opacity-50" disabled={!url.trim()} onClick={() => go(true)} data-testid="compartir-app">Compartir con todos</button>}
        <button className="rounded-lg bg-white/10 px-3 py-2 disabled:opacity-50" disabled={!url.trim()} onClick={() => go(false)}>Abrir solo para mí</button>
      </div>
      {tools.app && mod && <button className="w-full rounded-lg bg-red-600/70 py-2" onClick={() => tools.shareApp(null)}>⏹ Dejar de compartir «{tools.app.title}»</button>}
      <p className="pt-2 text-xs font-bold uppercase opacity-60">Sugerencias</p>
      <div className="grid grid-cols-2 gap-1">{APP_SUGGESTIONS.map(([n, u, d]) => (
        <button key={n} className="rounded-lg bg-white/5 p-2 text-left text-xs hover:bg-white/10" onClick={() => { setUrl(u); setTitle(n.replace(/^\S+\s/, '')); }} title={d}>{n}<span className="block opacity-60">{d}</span></button>))}</div>
    </div>
  );
}

export function RoomConfigPanel({ tools, sessionId, say }: { tools: Tools; sessionId: string; say: (m: string) => void }) {
  const [busy, setBusy] = useState(false);
  const toggle = async (k: keyof Policy) => { setBusy(true); const ok = await tools.savePolicy({ [k]: !allowed(tools.policy, k) }); setBusy(false); if (ok) say('⚙ Configuración aplicada a toda la sala.'); };
  const bulk = async (action: string, msg: string) => {
    const r = await fetch('/api/livekit/moderar', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ session: sessionId, action }) });
    say(r.ok ? msg : 'No se pudo completar.');
  };
  return (
    <div className="flex-1 space-y-2 overflow-y-auto p-3 text-sm" data-testid="config-sala">
      <p className="text-xs opacity-80">Se aplica al instante a todos los participantes (no a los anfitriones) y también a quienes entren después.</p>
      {POLICY_ITEMS.map(([k, label, hint]) => (
        <label key={k} className="flex items-start justify-between gap-3 rounded-lg bg-white/5 px-3 py-2">
          <span>{label}{hint && <span className="block text-[11px] opacity-60">{hint}</span>}</span>
          <input type="checkbox" className="mt-1" checked={allowed(tools.policy, k)} disabled={busy} onChange={() => toggle(k)} data-testid={`politica-${k}`} />
        </label>))}
      <div className="grid grid-cols-2 gap-2 pt-2">
        <button className="rounded-lg bg-white/10 py-2" onClick={() => bulk('mute_all', '🔇 Todos silenciados.')}>🔇 Silenciar a todos</button>
        <button className="rounded-lg bg-white/10 py-2" onClick={() => bulk('cam_off_all', '📷 Cámaras apagadas.')}>📷 Apagar cámaras</button>
      </div>
    </div>
  );
}

export function MySettingsPanel({ s, set, tools, say }: { s: MySettings; set: (p: Partial<MySettings>) => void; tools: Tools; say: (m: string) => void }) {
  const { localParticipant } = useLocalParticipant();
  const [name, setName] = useState(localParticipant.name ?? '');
  const row = 'flex items-start justify-between gap-3 rounded-lg bg-white/5 px-3 py-2';
  const chk = (k: keyof MySettings, label: string, hint?: string) => (
    <label className={row}><span>{label}{hint && <span className="block text-[11px] opacity-60">{hint}</span>}</span>
      <input type="checkbox" className="mt-1" checked={!!s[k]} onChange={(e) => set({ [k]: e.target.checked } as Partial<MySettings>)} data-testid={`ajuste-${k}`} /></label>);
  return (
    <div className="flex-1 space-y-3 overflow-y-auto p-3 text-sm" data-testid="mis-ajustes">
      <section className="space-y-1"><p className="text-xs font-bold uppercase opacity-60">🎙 Micrófono</p><div className="lk-device-list text-xs"><MediaDeviceSelect kind="audioinput" /></div></section>
      <section className="space-y-1"><p className="text-xs font-bold uppercase opacity-60">📷 Cámara</p><div className="text-xs"><MediaDeviceSelect kind="videoinput" /></div></section>
      <section className="space-y-1"><p className="text-xs font-bold uppercase opacity-60">🔊 Parlante / audífonos</p><div className="text-xs"><MediaDeviceSelect kind="audiooutput" /></div></section>
      <section className="space-y-1"><p className="text-xs font-bold uppercase opacity-60">Sonido</p>
        {chk('noise', 'Reducir ruido de fondo')}{chk('echo', 'Cancelar eco')}{chk('agc', 'Volumen automático del micrófono')}
        {chk('ptt', 'Mantener Espacio para hablar', 'Útil si está silenciado y quiere decir algo rápido.')}</section>
      <section className="space-y-1"><p className="text-xs font-bold uppercase opacity-60">Video</p>
        <label className={row}><span>Calidad del video que recibo<span className="block text-[11px] opacity-60">«Ahorro de datos» para celulares o internet lento.</span></span>
          <select value={s.quality} onChange={(e) => set({ quality: e.target.value as MySettings['quality'] })} className="rounded bg-white/10 px-1 text-xs" data-testid="ajuste-calidad">
            <option value="auto" className="text-black">Automática</option><option value="low" className="text-black">Ahorro de datos</option><option value="audio" className="text-black">Solo audio y pantalla</option></select></label>
        {chk('mirror', 'Ver mi cámara como espejo', 'Solo cambia cómo se ve usted mismo.')}
        {chk('hideNoVideo', 'Ocultar a quienes no tienen cámara')}
        {chk('screenOnly', 'Cuando alguien comparte, ver solo la pantalla', 'Oculta los videos de los participantes.')}</section>
      <section className="space-y-1"><p className="text-xs font-bold uppercase opacity-60">Equipo</p>
        {chk('wake', 'Mantener la pantalla encendida durante la clase')}</section>
      {tools.can('rename') && (
        <section className="space-y-1"><p className="text-xs font-bold uppercase opacity-60">✏ Mi nombre en la sala</p>
          <form className="flex gap-1" onSubmit={async (e) => { e.preventDefault(); const n = name.trim().slice(0, 60); if (n.length < 2) return; try { await localParticipant.setName(n); say('Nombre actualizado.'); } catch { say('No se pudo cambiar el nombre.'); } }}>
            <input value={name} onChange={(e) => setName(e.target.value)} maxLength={60} className="min-w-0 flex-1 rounded-lg bg-white/10 px-2 py-1.5" aria-label="Mi nombre" />
            <button className="rounded-lg bg-blue-600 px-3">Cambiar</button></form></section>)}
    </div>
  );
}

export function AttendancePanel({ sessionId, title, live }: { sessionId: string; title: string; live: Participant[] }) {
  const [rows, setRows] = useState<AttendanceRow[] | null>(null); const [err, setErr] = useState<string | null>(null);
  const load = useCallback(async () => { const r = await getAttendance(sessionId); if (r.ok) setRows(r.rows ?? []); else setErr(r.error ?? 'No disponible'); }, [sessionId]);
  useEffect(() => { load(); const i = setInterval(load, 20000); return () => clearInterval(i); }, [load]);
  const csv = () => {
    const q = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""').replace(/^([=+\-@])/, "'$1")}"`;
    const lines = [['Nombre', 'Correo', 'Entró', 'Salió', 'Minutos', 'Conexiones', 'En la sala ahora'].map(q).join(';'),
      ...(rows ?? []).map((r) => [r.full_name, r.email, new Date(r.first_join).toLocaleString('es-CL'), r.last_leave ? new Date(r.last_leave).toLocaleString('es-CL') : '', r.minutes, r.connections, r.online ? 'Sí' : 'No'].map(q).join(';'))];
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' }));
    a.download = `Asistencia - ${title}.csv`.replace(/[\\/:*?"<>|]/g, '-'); a.click();
  };
  return (
    <div className="flex-1 space-y-2 overflow-y-auto p-3 text-sm" data-testid="asistencia">
      <p className="text-xs opacity-80">Ahora en la sala: <b>{live.length}</b>. El registro completo se guarda automáticamente.</p>
      {err && <p className="text-xs text-amber-300">{err}</p>}
      <ul className="space-y-1">{live.map((p) => <li key={p.identity} className="flex justify-between rounded bg-white/5 px-2 py-1 text-xs"><span>🟢 {p.name || 'Participante'}</span><span className="opacity-60">{roleOf(p) === 'guest' ? 'invitado' : ''}</span></li>)}</ul>
      {rows && rows.length > 0 && (<>
        <p className="pt-2 text-xs font-bold uppercase opacity-60">Registro de la sesión</p>
        <ul className="space-y-1">{rows.map((r) => <li key={r.user_id} className="rounded bg-white/5 px-2 py-1 text-xs"><b>{r.full_name}</b> · {Number(r.minutes)} min · {r.connections} conexión(es){r.online ? ' · 🟢' : ''}</li>)}</ul></>)}
      <button className="w-full rounded-lg bg-white/10 py-2" onClick={csv} disabled={!rows?.length}>⬇ Descargar asistencia (Excel)</button>
    </div>
  );
}

/** ✉ Mensajes privados dentro del chat. */
export function PrivateMessages({ tools, me }: { tools: Tools; me: string }) {
  if (!tools.dms.length) return null;
  return (
    <div className="max-h-40 space-y-1 overflow-y-auto border-b border-white/10 bg-purple-900/20 p-2 text-xs" data-testid="privados">
      <p className="font-semibold">✉ Mensajes privados</p>
      {tools.dms.map((d) => <p key={d.id}><b>{d.from === me ? `Usted → ${d.toName}` : `${d.fromName} → usted`}:</b> {d.text}</p>)}
    </div>
  );
}

/** Atajos de teclado de la sala. */
export function useShortcuts(h: { mic: () => void; cam: () => void; hand: () => void; chat: () => void; people: () => void; tools: () => void; ptt: (down: boolean) => void; pttOn: boolean }) {
  const ref = useRef(h); ref.current = h;
  useEffect(() => {
    const typing = (e: KeyboardEvent) => { const t = e.target as HTMLElement | null; return !!t && (t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName)); };
    let held = false;
    const down = (e: KeyboardEvent) => {
      if (typing(e)) return;
      const k = e.key.toLowerCase(), c = ref.current;
      if ((e.ctrlKey || e.metaKey) && k === 'd') { e.preventDefault(); c.mic(); }
      else if ((e.ctrlKey || e.metaKey) && k === 'e') { e.preventDefault(); c.cam(); }
      else if (e.altKey && k === 'y') { e.preventDefault(); c.hand(); }
      else if (e.altKey && k === 'c') { e.preventDefault(); c.chat(); }
      else if (e.altKey && k === 'p') { e.preventDefault(); c.people(); }
      else if (e.altKey && k === 'h') { e.preventDefault(); c.tools(); }
      else if (k === ' ' && c.pttOn && !held && !e.repeat) { held = true; e.preventDefault(); c.ptt(true); }
    };
    const up = (e: KeyboardEvent) => { if (e.key === ' ' && held) { held = false; ref.current.ptt(false); } };
    window.addEventListener('keydown', down); window.addEventListener('keyup', up);
    return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up); };
  }, []);
}
