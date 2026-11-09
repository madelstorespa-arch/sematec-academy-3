'use client';
import '@livekit/components-styles';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import {
  LiveKitRoom, RoomAudioRenderer, StartAudio, ConnectionStateToast, GridLayout, FocusLayoutContainer, FocusLayout,
  CarouselLayout, ParticipantTile, TrackToggle, DisconnectButton, MediaDeviceMenu, useTracks, useChat, useParticipants,
  useLocalParticipant, useRoomContext, useDataChannel, useLocalParticipantPermissions, LayoutContextProvider,
} from '@livekit/components-react';
import { Track, RoomEvent, type LocalVideoTrack, type Participant } from 'livekit-client';
import { CONF_ROLES } from '@/lib/format';
import { createBrowser } from '@/lib/supabase/browser';

type Conn = { token: string; url: string; role: string; moderator: boolean };
type Opts = { sessionId: string; title: string; recording: boolean; chatEnabled: boolean };
const EMOJIS = ['👍', '👏', '❤️', '😂', '😮', '🎉', '🙌', '🤔', '👌', '🔥', '✅', '❌', '😀', '😊', '😍', '🙏', '💯', '📌', '✋', '👋', '☕', '📚', '💡', '⭐'];
const REACTIONS = ['👍', '👏', '❤️', '😂', '😮', '🎉', '🙌', '🤔'];
const BACKGROUNDS = [
  ['azul-institucional', 'Azul institucional'], ['aula', 'Aula'], ['biblioteca', 'Biblioteca'],
  ['oficina', 'Oficina'], ['naturaleza', 'Naturaleza'], ['atardecer', 'Atardecer'],
] as const;
const canDisplayCapture = () => typeof navigator !== 'undefined' && !!navigator.mediaDevices && 'getDisplayMedia' in navigator.mediaDevices;
const enc = new TextEncoder(); const dec = new TextDecoder();

export function Room(props: Opts) {
  const [conn, setConn] = useState<Conn | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const join = useCallback(async () => {
    setBusy(true); setError(null);
    try {
      const r = await fetch('/api/livekit/token', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ session: props.sessionId }) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? 'No se pudo obtener acceso');
      setConn(j);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Sin conexión con el servidor');
    } finally { setBusy(false); }
  }, [props.sessionId]);

  if (!conn) {
    return (
      <div className="mx-auto mt-10 max-w-lg card card-pad text-center">
        <h1 className="text-xl font-bold">{props.title}</h1>
        <p className="mt-2 text-sm text-slate-600">Al entrar, el navegador pedirá permiso para usar cámara y micrófono. Puede entrar con ambos apagados.</p>
        {props.recording && <p className="mt-2 rounded bg-amber-50 p-2 text-sm text-amber-800">🔴 Esta sesión puede ser grabada por el anfitrión. Se avisará en pantalla mientras se graba.</p>}
        <button onClick={join} disabled={busy} className="btn-primary mt-5">{busy ? 'Conectando…' : 'Entrar a la sala'}</button>
        {error && <p className="mt-4 rounded bg-red-50 p-2 text-sm text-red-700">{error}</p>}
        <p className="mt-4"><Link className="link text-sm" href={`/app/conferencias/${props.sessionId}`}>Detalle de la sesión y grabaciones</Link></p>
      </div>
    );
  }
  return (
    <div data-lk-theme="default" className="fixed inset-0 z-50 flex flex-col bg-[#111]">
      <LiveKitRoom serverUrl={conn.url} token={conn.token} connect video={false} audio={false}
        onDisconnected={() => setConn(null)} onError={(e) => setError(e.message)} style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
        <LayoutContextProvider>
          <Stage {...props} conn={conn} />
        </LayoutContextProvider>
        <RoomAudioRenderer />
        <StartAudio label="Activar audio" />
        <ConnectionStateToast />
      </LiveKitRoom>
    </div>
  );
}

type Floating = { id: number; emoji: string; left: number; from: string };

function Stage({ sessionId, title, recording, chatEnabled, conn }: Opts & { conn: Conn }) {
  const room = useRoomContext();
  const { localParticipant } = useLocalParticipant();
  const hookPerms = useLocalParticipantPermissions();
  const participants = useParticipants();
  const [panel, setPanel] = useState<'chat' | 'people' | 'effects' | null>(null);
  const [layout, setLayout] = useState<'grid' | 'speaker'>('grid');
  const [floating, setFloating] = useState<Floating[]>([]);
  const [showReactions, setShowReactions] = useState(false);
  const [unread, setUnread] = useState(0);
  const [recBy, setRecBy] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [, force] = useState(0);
  const mod = conn.moderator;
  const chat = useChat(); // una sola instancia: conserva los mensajes aunque el panel esté cerrado
  const seen = useRef(0);
  useEffect(() => {
    if (panel === 'chat') { seen.current = chat.chatMessages.length; setUnread(0); }
    else setUnread(chat.chatMessages.filter((m, i) => i >= seen.current && m.from?.identity !== localParticipant.identity).length);
  }, [chat.chatMessages, panel, localParticipant.identity]);

  // Repintar cuando cambian atributos (mano levantada) o permisos
  useEffect(() => {
    const f = () => force((n) => n + 1);
    room.on(RoomEvent.ParticipantAttributesChanged, f).on(RoomEvent.ParticipantPermissionsChanged, f);
    return () => { room.off(RoomEvent.ParticipantAttributesChanged, f).off(RoomEvent.ParticipantPermissionsChanged, f); };
  }, [room]);

  const say = useCallback((m: string) => { setToast(m); setTimeout(() => setToast(null), 3500); }, []);
  const addFloating = useCallback((emoji: string, from: string) => {
    const id = Date.now() + Math.random();
    setFloating((f) => [...f.slice(-25), { id, emoji, from, left: 10 + Math.random() * 80 }]);
    setTimeout(() => setFloating((f) => f.filter((x) => x.id !== id)), 4000);
  }, []);
  const { send: sendReaction } = useDataChannel('reaccion', (m) => addFloating(dec.decode(m.payload).slice(0, 8), m.from?.name ?? ''));
  const { send: sendRec } = useDataChannel('grabacion', (m) => { const on = dec.decode(m.payload) === '1'; setRecBy(on ? (m.from?.name ?? 'El anfitrión') : null); });
  const react = (e: string) => { sendReaction(enc.encode(e), { reliable: false }); addFloating(e, localParticipant.name ?? ''); setShowReactions(false); };

  const hand = !!localParticipant.attributes?.hand;
  const toggleHand = async () => {
    try { await localParticipant.setAttributes({ ...localParticipant.attributes, hand: hand ? '' : String(Date.now()) }); force((n) => n + 1); }
    catch { say('No se pudo levantar la mano.'); }
  };
  const hands = participants.filter((p) => p.attributes?.hand).sort((a, b) => Number(a.attributes.hand) - Number(b.attributes.hand));

  const perms = hookPerms ?? localParticipant.permissions;
  const canShare = !!perms?.canPublishSources?.some((x) => Number(x) === 3) && canDisplayCapture();
  const tracks = useTracks([{ source: Track.Source.Camera, withPlaceholder: true }, { source: Track.Source.ScreenShare, withPlaceholder: false }], { onlySubscribed: false });
  const screen = tracks.find((t) => t.publication?.source === Track.Source.ScreenShare);
  const speaker = useMemo(() => [...participants].sort((a, b) => Number(b.isSpeaking) - Number(a.isSpeaking) || b.audioLevel - a.audioLevel)[0], [participants]);
  const focus = screen ?? (layout === 'speaker' ? tracks.find((t) => t.participant.identity === speaker?.identity && t.source === Track.Source.Camera) : undefined);

  const moderate = async (action: string, identity?: string) => {
    const r = await fetch('/api/livekit/moderar', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ session: sessionId, action, identity }) });
    const j = await r.json().catch(() => ({}));
    say(r.ok ? 'Listo.' : j.error ?? 'No se pudo completar.');
  };

  return (
    <div className="relative flex min-h-0 flex-1 flex-col text-white">
      <header className="flex items-center justify-between gap-2 border-b border-white/10 px-3 py-2 text-sm">
        <span className="truncate font-semibold">{title}</span>
        <span className="flex shrink-0 items-center gap-2 text-xs">
          {recBy && <span className="animate-pulse rounded bg-red-600 px-2 py-0.5 font-bold">● GRABANDO</span>}
          <span className="opacity-70">{participants.length} 👥 · {CONF_ROLES[conn.role] ?? conn.role}</span>
        </span>
      </header>
      {hands.length > 0 && (
        <div className="flex flex-wrap gap-2 bg-amber-500/20 px-3 py-1 text-xs" data-testid="manos">
          ✋ {hands.map((p) => p.name || 'Participante').join(', ')}
        </div>)}

      <div className="relative flex min-h-0 flex-1">
        <div className="lk-video-conference relative min-w-0 flex-1" style={{ height: '100%' }}>
          {focus ? (
            <FocusLayoutContainer>
              <CarouselLayout tracks={tracks.filter((t) => t !== focus)}><ParticipantTile /></CarouselLayout>
              <FocusLayout trackRef={focus as any} />
            </FocusLayoutContainer>
          ) : (
            <GridLayout tracks={tracks} style={{ height: '100%' }}><ParticipantTile /></GridLayout>
          )}
          <div className="pointer-events-none absolute inset-0 overflow-hidden">
            {floating.map((f) => (
              <span key={f.id} className="reaction-float absolute bottom-6 text-4xl" style={{ left: `${f.left}%` }} title={f.from}>{f.emoji}</span>))}
          </div>
        </div>
        {panel && (
          <aside className="absolute inset-0 z-10 flex flex-col bg-[#1b1b1f] sm:static sm:w-80 sm:border-l sm:border-white/10">
            <div className="flex items-center justify-between border-b border-white/10 px-3 py-2 text-sm font-semibold">
              <span>{panel === 'chat' ? '💬 Chat' : panel === 'people' ? `👥 Participantes (${participants.length})` : '🖼 Fondo y efectos'}</span>
              <button onClick={() => setPanel(null)} className="rounded px-2 hover:bg-white/10" aria-label="Cerrar panel">✕</button>
            </div>
            {panel === 'chat' && <ChatPanel enabled={chatEnabled || mod} chat={chat} />}
            {panel === 'people' && <PeoplePanel mod={mod} me={localParticipant.identity} participants={participants} moderate={moderate} />}
            {panel === 'effects' && <EffectsPanel say={say} />}
          </aside>)}
      </div>

      {toast && <div className="absolute bottom-24 left-1/2 z-20 -translate-x-1/2 rounded-lg bg-black/80 px-4 py-2 text-sm">{toast}</div>}

      <footer className="flex flex-wrap items-center justify-center gap-1 border-t border-white/10 px-2 py-2 sm:gap-2">
        <span className="flex items-center"><TrackToggle source={Track.Source.Microphone} showIcon>Micrófono</TrackToggle><MediaDeviceMenu kind="audioinput" /></span>
        <span className="flex items-center"><TrackToggle source={Track.Source.Camera} showIcon>Cámara</TrackToggle><MediaDeviceMenu kind="videoinput" /></span>
        {canShare && <TrackToggle source={Track.Source.ScreenShare} showIcon captureOptions={{ audio: true, selfBrowserSurface: 'include' } as any}>Compartir pantalla</TrackToggle>}
        <button className={`lk-button ${panel === 'effects' ? 'lk-button-active' : ''}`} onClick={() => setPanel(panel === 'effects' ? null : 'effects')} title="Desenfoque y fondos virtuales">🖼 Fondo</button>
        <span className="relative">
          <button className="lk-button" onClick={() => setShowReactions((v) => !v)} title="Reacciones">😀 Reaccionar</button>
          {showReactions && (
            <span className="absolute bottom-12 left-1/2 z-20 flex -translate-x-1/2 gap-1 rounded-xl bg-[#222] p-2 shadow-xl">
              {REACTIONS.map((e) => <button key={e} className="rounded p-1 text-2xl hover:bg-white/10" onClick={() => react(e)} aria-label={`Reaccionar ${e}`}>{e}</button>)}
            </span>)}
        </span>
        <button className={`lk-button ${hand ? 'lk-button-active' : ''}`} onClick={toggleHand}>{hand ? '✋ Bajar la mano' : '✋ Levantar la mano'}</button>
        <button className={`lk-button ${panel === 'chat' ? 'lk-button-active' : ''}`} onClick={() => setPanel(panel === 'chat' ? null : 'chat')}>
          💬 Chat{unread > 0 && <span className="ml-1 rounded-full bg-red-600 px-1.5 text-xs">{unread}</span>}</button>
        <button className={`lk-button ${panel === 'people' ? 'lk-button-active' : ''}`} onClick={() => setPanel(panel === 'people' ? null : 'people')}>👥 Personas{hands.length > 0 && <span className="ml-1 rounded-full bg-amber-500 px-1.5 text-xs">{hands.length}</span>}</button>
        <button className="lk-button" onClick={() => setLayout(layout === 'grid' ? 'speaker' : 'grid')} title="Cambiar vista">{layout === 'grid' ? '🗣 Vista orador' : '▦ Vista galería'}</button>
        {mod && recording && <Recorder sessionId={sessionId} title={title} say={say} broadcast={(on) => { sendRec(enc.encode(on ? '1' : '0'), { reliable: true }); setRecBy(on ? (localParticipant.name ?? 'Usted') : null); }} />}
        <button className="lk-button hidden sm:inline-flex" onClick={() => (document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen()).catch(() => {})}>⛶ Pantalla completa</button>
        <DisconnectButton>Salir</DisconnectButton>
      </footer>
    </div>
  );
}

function ChatPanel({ enabled, chat }: { enabled: boolean; chat: ReturnType<typeof useChat> }) {
  const { chatMessages, send, isSending } = chat;
  const [text, setText] = useState('');
  const [emojis, setEmojis] = useState(false);
  const list = useRef<HTMLDivElement>(null);
  const { localParticipant } = useLocalParticipant();
  useEffect(() => { list.current?.scrollTo({ top: list.current.scrollHeight }); }, [chatMessages.length]);
  const submit = async () => { const t = text.trim(); if (!t) return; await send(t.slice(0, 2000)); setText(''); setEmojis(false); };
  return (
    <>
      <div ref={list} className="flex-1 space-y-2 overflow-y-auto p-3 text-sm" data-testid="chat-mensajes">
        {chatMessages.length === 0 && <p className="text-center text-xs opacity-60">Aún no hay mensajes. Salude a la clase 👋</p>}
        {chatMessages.map((m) => {
          const mine = m.from?.identity === localParticipant.identity;
          return (
            <div key={m.id} className={`max-w-[85%] rounded-xl px-3 py-2 ${mine ? 'ml-auto bg-blue-600' : 'bg-white/10'}`}>
              <p className="text-[11px] opacity-70">{mine ? 'Usted' : m.from?.name || 'Participante'} · {new Date(m.timestamp).toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' })}</p>
              <p className="whitespace-pre-wrap break-words">{m.message}</p>
            </div>);
        })}
      </div>
      {enabled ? (
        <div className="relative border-t border-white/10 p-2">
          {emojis && (
            <div className="absolute bottom-14 left-2 right-2 grid grid-cols-8 gap-1 rounded-xl bg-[#2a2a2e] p-2 shadow-xl">
              {EMOJIS.map((e) => <button key={e} className="rounded p-1 text-xl hover:bg-white/10" onClick={() => setText((t) => t + e)}>{e}</button>)}
            </div>)}
          <form className="flex gap-1" onSubmit={(e) => { e.preventDefault(); submit(); }}>
            <button type="button" className="rounded-lg px-2 text-xl hover:bg-white/10" onClick={() => setEmojis((v) => !v)} aria-label="Emojis">😊</button>
            <input className="min-w-0 flex-1 rounded-lg bg-white/10 px-3 py-2 text-sm outline-none placeholder:text-white/50" value={text} maxLength={2000}
              onChange={(e) => setText(e.target.value)} placeholder="Escriba un mensaje…" aria-label="Mensaje del chat" />
            <button className="rounded-lg bg-blue-600 px-3 text-sm font-semibold disabled:opacity-50" disabled={isSending || !text.trim()}>Enviar</button>
          </form>
        </div>) : <p className="border-t border-white/10 p-3 text-center text-xs opacity-70">El anfitrión desactivó el chat para los participantes.</p>}
    </>
  );
}

function PeoplePanel({ mod, me, participants, moderate }: { mod: boolean; me: string; participants: Participant[]; moderate: (a: string, id?: string) => void }) {
  return (
    <div className="flex-1 overflow-y-auto p-2 text-sm" data-testid="personas">
      {mod && <button className="mb-2 w-full rounded-lg bg-white/10 py-2 text-xs hover:bg-white/20" onClick={() => moderate('mute_all')}>🔇 Silenciar a todos</button>}
      <ul className="space-y-1">
        {participants.map((p) => {
          let role = ''; try { role = JSON.parse(p.metadata || '{}').role ?? ''; } catch { /* */ }
          const isMe = p.identity === me;
          return (
            <li key={p.identity} className="rounded-lg px-2 py-2 hover:bg-white/5">
              <div className="flex items-center justify-between gap-2">
                <span className="min-w-0 truncate">{p.attributes?.hand && '✋ '}{p.name || 'Participante'}{isMe && ' (usted)'}<span className="block text-[11px] opacity-60">{CONF_ROLES[role] ?? role}</span></span>
                <span className="shrink-0 text-xs">{p.isMicrophoneEnabled ? '🎙' : '🔇'} {p.isCameraEnabled ? '📷' : ''} {p.isScreenShareEnabled ? '🖥' : ''}</span>
              </div>
              {mod && !isMe && (
                <div className="mt-1 flex flex-wrap gap-1 text-[11px]">
                  {p.isMicrophoneEnabled && <button className="rounded bg-white/10 px-2 py-0.5 hover:bg-white/20" onClick={() => moderate('mute', p.identity)}>Silenciar</button>}
                  {p.attributes?.hand && <button className="rounded bg-white/10 px-2 py-0.5 hover:bg-white/20" onClick={() => moderate('lower_hand', p.identity)}>Bajar mano</button>}
                  {p.attributes?.share
                    ? <button className="rounded bg-white/10 px-2 py-0.5 hover:bg-white/20" onClick={() => moderate('revoke_share', p.identity)}>Quitar pantalla</button>
                    : <button className="rounded bg-white/10 px-2 py-0.5 hover:bg-white/20" onClick={() => moderate('allow_share', p.identity)}>Permitir compartir pantalla</button>}
                  <button className="rounded bg-red-600/70 px-2 py-0.5 hover:bg-red-600" onClick={() => { if (confirm(`¿Sacar a ${p.name} de la sala?`)) moderate('remove', p.identity); }}>Expulsar</button>
                </div>)}
            </li>);
        })}
      </ul>
    </div>
  );
}

function EffectsPanel({ say }: { say: (m: string) => void }) {
  const { localParticipant, isCameraEnabled } = useLocalParticipant();
  const [mode, setMode] = useState<string>('none');
  const [supported, setSupported] = useState(true);
  const proc = useRef<any>(null);
  useEffect(() => { import('@livekit/track-processors').then((m) => setSupported(m.supportsBackgroundProcessors())).catch(() => setSupported(false)); }, []);

  const apply = async (key: string, opts: { mode: 'disabled' } | { mode: 'background-blur'; blurRadius: number } | { mode: 'virtual-background'; imagePath: string }) => {
    const track = localParticipant.getTrackPublication(Track.Source.Camera)?.track as LocalVideoTrack | undefined;
    if (!track) { say('Primero encienda su cámara.'); return; }
    try {
      const m = await import('@livekit/track-processors');
      if (!proc.current) {
        if (opts.mode === 'disabled') { setMode('none'); return; }
        proc.current = m.BackgroundProcessor({ ...opts, assetPaths: { tasksVisionFileSet: '/mediapipe/wasm' } } as any);
        await track.setProcessor(proc.current);
      } else {
        await proc.current.switchTo(opts);
      }
      setMode(key);
    } catch (e) {
      console.error(e); say('No se pudo aplicar el efecto en este dispositivo.');
    }
  };
  const upload = (f: File | undefined) => { if (!f || !f.type.startsWith('image/')) return; apply('propia', { mode: 'virtual-background', imagePath: URL.createObjectURL(f) }); };

  if (!supported) return <p className="p-4 text-sm opacity-80">Su navegador no permite fondos virtuales. Use Chrome o Edge en un computador. En celulares, el desenfoque depende del modelo.</p>;
  const Opt = ({ k, label, onClick, children }: { k: string; label: string; onClick: () => void; children?: React.ReactNode }) => (
    <button onClick={onClick} className={`overflow-hidden rounded-lg border-2 text-left text-xs ${mode === k ? 'border-blue-500' : 'border-transparent'}`}>
      <span className="flex h-16 items-center justify-center bg-white/10 text-2xl">{children}</span><span className="block px-1 py-1">{label}</span>
    </button>);
  return (
    <div className="flex-1 overflow-y-auto p-3" data-testid="efectos">
      {!isCameraEnabled && <p className="mb-3 rounded bg-amber-500/20 p-2 text-xs">Encienda su cámara para ver el efecto.</p>}
      <div className="grid grid-cols-2 gap-2">
        <Opt k="none" label="Sin efecto" onClick={() => apply('none', { mode: 'disabled' })}>🚫</Opt>
        <Opt k="blur-s" label="Desenfoque suave" onClick={() => apply('blur-s', { mode: 'background-blur', blurRadius: 6 })}>🌫</Opt>
        <Opt k="blur-f" label="Desenfoque fuerte" onClick={() => apply('blur-f', { mode: 'background-blur', blurRadius: 16 })}>🌁</Opt>
        {BACKGROUNDS.map(([k, l]) => (
          <button key={k} onClick={() => apply(k, { mode: 'virtual-background', imagePath: `/fondos/${k}.jpg` })} className={`overflow-hidden rounded-lg border-2 text-left text-xs ${mode === k ? 'border-blue-500' : 'border-transparent'}`}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={`/fondos/${k}.jpg`} alt="" className="h-16 w-full object-cover" /><span className="block px-1 py-1">{l}</span>
          </button>))}
        <label className={`cursor-pointer overflow-hidden rounded-lg border-2 text-xs ${mode === 'propia' ? 'border-blue-500' : 'border-dashed border-white/30'}`}>
          <span className="flex h-16 items-center justify-center text-2xl">➕</span><span className="block px-1 py-1">Mi imagen</span>
          <input type="file" accept="image/*" className="hidden" onChange={(e) => upload(e.target.files?.[0])} />
        </label>
      </div>
      <p className="mt-3 text-[11px] opacity-60">El efecto se procesa en su equipo: la imagen original de su cámara no sale de su dispositivo.</p>
    </div>
  );
}

/** Grabación desde el navegador del anfitrión: graba la pestaña de la clase (video + audio de todos + su micrófono). */
function Recorder({ sessionId, title, say, broadcast }: { sessionId: string; title: string; say: (m: string) => void; broadcast: (on: boolean) => void }) {
  const [state, setState] = useState<'idle' | 'rec' | 'done' | 'uploading' | 'saved'>('idle');
  const [secs, setSecs] = useState(0);
  const [blob, setBlob] = useState<Blob | null>(null);
  const [savedId, setSavedId] = useState<string | null>(null);
  const rec = useRef<MediaRecorder | null>(null);
  const streams = useRef<MediaStream[]>([]);
  const started = useRef(0);
  useEffect(() => { if (state !== 'rec') return; const t = setInterval(() => setSecs(Math.round((Date.now() - started.current) / 1000)), 1000); return () => clearInterval(t); }, [state]);
  if (!canDisplayCapture()) return null;

  const start = async () => {
    try {
      const display = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 24 }, audio: true, preferCurrentTab: true, selfBrowserSurface: 'include', systemAudio: 'include' } as any);
      const ctx = new AudioContext(); const dest = ctx.createMediaStreamDestination();
      if (display.getAudioTracks().length) ctx.createMediaStreamSource(display).connect(dest);
      try { const mic = await navigator.mediaDevices.getUserMedia({ audio: true }); streams.current.push(mic); ctx.createMediaStreamSource(mic).connect(dest); } catch { /* sin micrófono */ }
      streams.current.push(display);
      const out = new MediaStream([...display.getVideoTracks(), ...dest.stream.getAudioTracks()]);
      const mime = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'].find((m) => MediaRecorder.isTypeSupported(m)) ?? '';
      const r = new MediaRecorder(out, { mimeType: mime, videoBitsPerSecond: 1_200_000 });
      const chunks: Blob[] = [];
      r.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
      r.onstop = () => {
        streams.current.forEach((s) => s.getTracks().forEach((t) => t.stop())); streams.current = []; ctx.close();
        setBlob(new Blob(chunks, { type: 'video/webm' })); setState('done'); broadcast(false);
      };
      display.getVideoTracks()[0].addEventListener('ended', () => r.state !== 'inactive' && r.stop());
      r.start(5000); rec.current = r; started.current = Date.now(); setSecs(0); setState('rec'); broadcast(true);
      say('🔴 Grabando. Todos ven el aviso de grabación.');
    } catch { say('Grabación cancelada. Elija «Esta pestaña» y marque «Compartir audio».'); }
  };
  const stop = () => rec.current?.state !== 'inactive' && rec.current?.stop();
  const filename = `Grabación - ${title} - ${new Date().toLocaleDateString('es-CL')}.webm`.replace(/[\\/:*?"<>|]/g, '-');
  const download = () => { if (!blob) return; const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = filename; a.click(); };
  const save = async () => {
    if (!blob) return; setState('uploading');
    try {
      const r1 = await fetch('/api/grabaciones/subir', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ session: sessionId, size: blob.size, mime: blob.type }) });
      const j1 = await r1.json(); if (!r1.ok) throw new Error(j1.error);
      const up = await createBrowser().storage.from('conference-recordings').uploadToSignedUrl(j1.path, j1.token, blob, { contentType: 'video/webm' });
      if (up.error) throw new Error(/size|large|exceed/i.test(up.error.message) ? 'La grabación es más grande que lo que permite su plan de almacenamiento (Supabase Free: 50 MB por archivo). Descárguela en su equipo o active Supabase Pro.' : up.error.message);
      const r2 = await fetch('/api/grabaciones/registrar', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ session: sessionId, path: j1.path, size: blob.size, duration: secs, filename }) });
      const j2 = await r2.json(); if (!r2.ok) throw new Error(j2.error);
      setSavedId(j2.id); setState('saved'); say('✓ Grabación guardada en la plataforma.');
    } catch (e) { setState('done'); say((e as Error).message || 'No se pudo subir la grabación.'); }
  };
  const share = async () => {
    const url = `${location.origin}/app/conferencias/grabacion/${savedId}`;
    if (navigator.share) await navigator.share({ title: `Grabación: ${title}`, url }).catch(() => {}); else { await navigator.clipboard.writeText(url); say('Enlace copiado.'); }
  };
  const mmss = `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`;

  if (state === 'rec') return <button className="lk-button" style={{ background: '#dc2626' }} onClick={stop}>⏹ Detener ({mmss})</button>;
  if (state === 'idle') return <button className="lk-button" onClick={start}>⏺ Grabar</button>;
  return (
    <span className="fixed bottom-20 left-1/2 z-30 w-[92vw] max-w-md -translate-x-1/2 rounded-xl bg-[#222] p-4 text-sm shadow-2xl">
      <b>🎬 Grabación lista</b> <span className="opacity-70">({mmss}, {blob ? (blob.size / 1048576).toFixed(1) : 0} MB)</span>
      <span className="mt-3 flex flex-wrap gap-2">
        <button className="rounded-lg bg-white/10 px-3 py-2 hover:bg-white/20" onClick={download}>⬇ Descargar</button>
        {state !== 'saved'
          ? <button className="rounded-lg bg-blue-600 px-3 py-2 disabled:opacity-60" disabled={state === 'uploading'} onClick={save}>{state === 'uploading' ? 'Subiendo…' : '☁ Guardar en la plataforma'}</button>
          : <button className="rounded-lg bg-blue-600 px-3 py-2" onClick={share}>📤 Compartir enlace</button>}
        <button className="rounded-lg px-3 py-2 opacity-70 hover:opacity-100" onClick={() => { setBlob(null); setState('idle'); setSavedId(null); }}>Cerrar</button>
      </span>
      {state === 'saved' && <span className="mt-2 block text-xs opacity-70">Los participantes la verán en el detalle de la sesión.</span>}
    </span>
  );
}
