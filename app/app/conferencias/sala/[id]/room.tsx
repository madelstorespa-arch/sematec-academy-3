'use client';
import '@livekit/components-styles';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import {
  LiveKitRoom, RoomAudioRenderer, StartAudio, ConnectionStateToast, GridLayout, FocusLayoutContainer, FocusLayout,
  CarouselLayout, ParticipantTile, TrackToggle, DisconnectButton, MediaDeviceMenu, useTracks, useChat, useParticipants,
  useLocalParticipant, useRoomContext, useDataChannel, useLocalParticipantPermissions, LayoutContextProvider,
} from '@livekit/components-react';
import { Track, RoomEvent, ScreenSharePresets, type LocalVideoTrack, type Participant } from 'livekit-client';
import { CONF_ROLES } from '@/lib/format';
import { createBrowser } from '@/lib/supabase/browser';
import { uploadRecording } from '@/lib/recordings-client';
import { uploadUserFile } from '@/components/file-uploader';

type Conn = { token: string; url: string; role: string; moderator: boolean };
type Opts = { sessionId: string; title: string; recording: boolean; chatEnabled: boolean; orgId: string; sectionId: string | null };
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

function Stage({ sessionId, title, recording, chatEnabled, orgId, sectionId, conn }: Opts & { conn: Conn }) {
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
  const sharePerm = !!perms?.canPublishSources?.some((x) => Number(x) === 3);
  const canShare = sharePerm && canDisplayCapture();
  const [shareHelp, setShareHelp] = useState(false);
  const [facing, setFacing] = useState<'user' | 'environment'>('user');
  const isMobile = typeof navigator !== 'undefined' && /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
  /** Cambia entre cámara frontal y trasera (en el celular sirve para mostrar un cuaderno, pizarra o documento). */
  const flipCamera = async () => {
    const next = facing === 'user' ? 'environment' : 'user';
    try {
      const pub = localParticipant.getTrackPublication(Track.Source.Camera);
      if (!pub?.track) { await localParticipant.setCameraEnabled(true, { facingMode: next }); }
      else await (pub.track as LocalVideoTrack).restartTrack({ facingMode: next });
      setFacing(next); say(next === 'environment' ? '📷 Cámara trasera: muestre su cuaderno, pizarra o documento.' : '🤳 Cámara frontal');
    } catch { say('No se pudo cambiar de cámara en este equipo.'); }
  };
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
      {localParticipant.isScreenShareEnabled && (
        <div className="flex flex-wrap items-center justify-center gap-2 bg-emerald-600/30 px-3 py-1 text-xs" data-testid="compartiendo">
          🟢 Está compartiendo su pantalla con todos
          <button className="rounded bg-white/15 px-2 py-0.5 font-semibold hover:bg-white/25" onClick={() => localParticipant.setScreenShareEnabled(false)}>⏹ Dejar de compartir</button>
        </div>)}
      {screen && screen.participant.identity !== localParticipant.identity && (
        <div className="flex items-center justify-center gap-2 bg-blue-600/20 px-3 py-1 text-xs" data-testid="pantalla-de">
          📺 Pantalla de {screen.participant.name || 'un participante'}
          <button className="rounded bg-white/15 px-2 py-0.5 hover:bg-white/25" onClick={() => (document.querySelector('.lk-focus-layout') as HTMLElement | null)?.requestFullscreen?.().catch(() => {})}>⛶ Ver en grande</button>
        </div>)}
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
            {panel === 'chat' && <ChatPanel enabled={chatEnabled || mod} chat={chat} orgId={orgId} sectionId={sectionId} say={say} />}
            {panel === 'people' && <PeoplePanel mod={mod} me={localParticipant.identity} participants={participants} moderate={moderate} />}
            {panel === 'effects' && <EffectsPanel say={say} />}
          </aside>)}
      </div>

      {shareHelp && (
        <div className="absolute inset-x-2 bottom-24 z-30 mx-auto max-w-md rounded-xl bg-[#222] p-4 text-sm shadow-2xl" data-testid="ayuda-compartir">
          <p className="font-semibold">📲 Compartir desde el celular</p>
          <p className="mt-1 opacity-80">Los navegadores de celulares (Android y iPhone) no permiten transmitir la pantalla completa. Puede mostrar su contenido así:</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button className="rounded-lg bg-blue-600 px-3 py-2" onClick={() => { setShareHelp(false); flipCamera(); }}>📷 Mostrar con la cámara trasera</button>
            <button className="rounded-lg bg-white/10 px-3 py-2" onClick={() => { setShareHelp(false); setPanel('chat'); }}>📎 Enviar foto, video o archivo al chat</button>
            <button className="rounded-lg px-3 py-2 opacity-70" onClick={() => setShareHelp(false)}>Cerrar</button>
          </div>
          <p className="mt-2 text-xs opacity-60">Para compartir la pantalla completa, entre desde un computador con Chrome, Edge o Firefox.</p>
        </div>)}
      {toast && <div className="absolute bottom-24 left-1/2 z-20 -translate-x-1/2 rounded-lg bg-black/80 px-4 py-2 text-sm">{toast}</div>}

      <footer className="flex flex-wrap items-center justify-center gap-1 border-t border-white/10 px-2 py-2 sm:gap-2">
        <span className="flex items-center"><TrackToggle source={Track.Source.Microphone} showIcon>Micrófono</TrackToggle><MediaDeviceMenu kind="audioinput" /></span>
        <span className="flex items-center"><TrackToggle source={Track.Source.Camera} showIcon>Cámara</TrackToggle><MediaDeviceMenu kind="videoinput" /></span>
        {canShare && <ShareButton say={say} />}
        {sharePerm && !canShare && <button className="lk-button" onClick={() => setShareHelp(true)} data-testid="compartir-celular">📲 Compartir pantalla</button>}
        {(isMobile || !canDisplayCapture()) && <button className="lk-button" onClick={flipCamera} title="Cambiar entre cámara frontal y trasera">🔄 Cámara</button>}
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

/** 🖥 Compartir pantalla con calidad a elección, audio y mensajes claros si el sistema bloquea el permiso. */
function ShareButton({ say }: { say: (m: string) => void }) {
  const { localParticipant } = useLocalParticipant();
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<'detail' | 'motion'>('detail');
  const [audio, setAudio] = useState(true);
  const [whole, setWhole] = useState(true);
  const [busy, setBusy] = useState(false);
  const sharing = localParticipant.isScreenShareEnabled;
  const share = async () => {
    setBusy(true); setOpen(false);
    try {
      const preset = mode === 'motion' ? ScreenSharePresets.h1080fps30 : ScreenSharePresets.h1080fps15;
      await localParticipant.setScreenShareEnabled(true, {
        audio, resolution: preset.resolution, contentHint: mode, selfBrowserSurface: 'include', surfaceSwitching: 'include',
        systemAudio: audio ? 'include' : 'exclude',
        // Toda la pantalla: el navegador abre directo en «Pantalla completa» y puede moverse por todo su equipo
        video: whole ? { displaySurface: 'monitor' } : true, monitorTypeSurfaces: 'include',
      } as any, { screenShareEncoding: preset.encoding, simulcast: false });
      say('🟢 Compartiendo su pantalla con todos.');
    } catch (e) {
      const n = (e as DOMException)?.name;
      say(n === 'NotAllowedError' ? 'No se compartió: canceló la ventana o el sistema no dio permiso. En Mac: Configuración → Privacidad → Grabación de pantalla → active Chrome.'
        : n === 'NotReadableError' ? 'El sistema bloqueó la captura de pantalla. En Windows/Mac, permita a Chrome grabar la pantalla y vuelva a intentar.'
        : n === 'NotFoundError' ? 'No se encontró una pantalla para compartir.'
        : `No se pudo compartir la pantalla (${(e as Error)?.message ?? n}).`);
    } finally { setBusy(false); }
  };
  if (sharing) return <button className="lk-button lk-button-active" onClick={() => localParticipant.setScreenShareEnabled(false)} data-testid="dejar-compartir">⏹ Dejar de compartir</button>;
  return (
    <span className="relative">
      <button className="lk-button" disabled={busy} onClick={() => setOpen((v) => !v)}>🖥 Compartir pantalla</button>
      {open && (
        <span className="absolute bottom-12 left-1/2 z-30 block w-[min(92vw,22rem)] -translate-x-1/2 rounded-xl bg-[#222] p-4 text-left text-sm shadow-2xl" data-testid="opciones-compartir">
          <b>¿Qué quiere compartir?</b>
          <label className={`mt-2 flex cursor-pointer gap-2 rounded-lg p-2 ${whole ? 'bg-emerald-600/30' : 'hover:bg-white/5'}`}>
            <input type="radio" name="superficie" checked={whole} onChange={() => setWhole(true)} className="mt-1" />
            <span><span className="font-semibold">🖥 Toda la pantalla</span><span className="block text-xs opacity-70">Puede navegar por todo su equipo (programas, carpetas, otras páginas) y todos ven lo que hace.</span></span></label>
          <label className={`mt-1 flex cursor-pointer gap-2 rounded-lg p-2 ${!whole ? 'bg-emerald-600/30' : 'hover:bg-white/5'}`}>
            <input type="radio" name="superficie" checked={!whole} onChange={() => setWhole(false)} className="mt-1" />
            <span><span className="font-semibold">🪟 Solo una ventana o pestaña</span><span className="block text-xs opacity-70">Los demás ven únicamente esa ventana.</span></span></label>
          <b className="mt-3 block">Calidad</b>
          <label className={`mt-2 flex cursor-pointer gap-2 rounded-lg p-2 ${mode === 'detail' ? 'bg-blue-600/30' : 'hover:bg-white/5'}`}>
            <input type="radio" name="calidad" checked={mode === 'detail'} onChange={() => setMode('detail')} className="mt-1" />
            <span><span className="font-semibold">📄 Texto nítido</span><span className="block text-xs opacity-70">Documentos, presentaciones, código (1080p).</span></span></label>
          <label className={`mt-1 flex cursor-pointer gap-2 rounded-lg p-2 ${mode === 'motion' ? 'bg-blue-600/30' : 'hover:bg-white/5'}`}>
            <input type="radio" name="calidad" checked={mode === 'motion'} onChange={() => setMode('motion')} className="mt-1" />
            <span><span className="font-semibold">🎞 Video fluido</span><span className="block text-xs opacity-70">Videos y movimientos (1080p, 30 cuadros por segundo).</span></span></label>
          <label className="mt-2 flex items-center gap-2 text-xs"><input type="checkbox" checked={audio} onChange={(e) => setAudio(e.target.checked)} /> Compartir también el audio (videos, música)</label>
          <span className="mt-3 flex gap-2">
            <button className="rounded-lg bg-blue-600 px-3 py-2 font-semibold" onClick={share}>Elegir qué compartir →</button>
            <button className="rounded-lg px-3 py-2 opacity-70" onClick={() => setOpen(false)}>Cancelar</button>
          </span>
          <span className="mt-2 block text-xs opacity-60">En la ventana del navegador elija «Pantalla completa» / «Toda la pantalla» y toque «Compartir». Mientras comparte puede minimizar esta sala y trabajar normalmente: la clase sigue viendo su pantalla.</span>
        </span>)}
    </span>
  );
}

const FILE_LINK = /\/app\/archivos\/ver\/([0-9a-f-]{36})/;
function ChatPanel({ enabled, chat, orgId, sectionId, say }: { enabled: boolean; chat: ReturnType<typeof useChat>; orgId: string; sectionId: string | null; say: (m: string) => void }) {
  const { chatMessages, send, isSending } = chat;
  const fileInput = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  /** 📎 Comparte una foto, video o documento con la clase (queda guardado en «Archivos»). */
  const attach = async (f: File | undefined) => {
    if (!f) return;
    setUploading(true);
    try {
      let id: string;
      try { id = await uploadUserFile(orgId, f, sectionId ? { visibility: 'section', section: sectionId } : { visibility: 'org' }); }
      catch (e) { if (!sectionId) throw e; id = await uploadUserFile(orgId, f, { visibility: 'org' }); }
      await send(`📎 ${f.name} — ${location.origin}/app/archivos/ver/${id}`);
    } catch (e) { say((e as Error).message); }
    finally { setUploading(false); if (fileInput.current) fileInput.current.value = ''; }
  };
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
              {(() => { const f = FILE_LINK.exec(m.message); return f
                ? <a className="whitespace-pre-wrap break-words underline" href={`/app/archivos/ver/${f[1]}`} target="_blank" rel="noopener noreferrer">{m.message.split(' — ')[0]}</a>
                : <p className="whitespace-pre-wrap break-words">{m.message}</p>; })()}
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
            <button type="button" className="rounded-lg px-2 text-xl hover:bg-white/10 disabled:opacity-50" disabled={uploading} onClick={() => fileInput.current?.click()} aria-label="Adjuntar archivo" title="Enviar foto, video o archivo">{uploading ? '⏳' : '📎'}</button>
            <input ref={fileInput} type="file" className="hidden" accept="image/*,video/*,audio/*,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.zip" data-testid="adjuntar-chat" onChange={(e) => attach(e.target.files?.[0])} />
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
                  {(p.attributes?.share === '1' || (p.attributes?.share !== '0' && !!p.permissions?.canPublishSources?.some((x) => Number(x) === 3)))
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
const SEGMENT_MS = 2 * 60 * 1000; // cada 2 minutos se guarda una parte en la plataforma
type Part = { n: number; secs: number; size: number; status: 'subiendo' | 'guardada' | 'error'; id?: string; blob?: Blob; error?: string };
type RecMode = 'tab' | 'screen' | 'choose' | 'area' | 'shared';
const REC_MODES: [RecMode, string, string][] = [
  ['tab', '🎬 Toda la sala', 'Graba esta pestaña: videos, pantalla compartida, chat y audio de todos.'],
  ['screen', '🖥 Pantalla completa con todos los movimientos', 'Todo lo que pasa en su monitor, con el cursor, a 30 cuadros por segundo.'],
  ['choose', '🪟 Una ventana o pestaña que yo elija', 'El navegador le deja escoger qué ventana, pestaña o pantalla grabar.'],
  ['area', '✂ Solo un área', 'Después de aceptar, arrastre el mouse para marcar el rectángulo que quiere grabar.'],
  ['shared', '📺 Solo la pantalla compartida', 'Graba la pantalla que alguien está compartiendo, con el audio de la clase.'],
];
type Rect = { x: number; y: number; w: number; h: number };

/**
 * Grabación de la clase guardada en TIEMPO REAL (una parte cada 2 minutos), con modos:
 * toda la sala, pantalla completa con movimientos, ventana elegida, solo un área o solo la pantalla compartida.
 * Se puede pausar y reanudar para grabar solo lo que interesa.
 */
function Recorder({ sessionId, title, say, broadcast }: { sessionId: string; title: string; say: (m: string) => void; broadcast: (on: boolean) => void }) {
  const room = useRoomContext();
  const [state, setState] = useState<'idle' | 'setup' | 'area' | 'rec' | 'finishing' | 'done'>('idle');
  const [mode, setMode] = useState<RecMode>('tab');
  const [hq, setHq] = useState(false);
  const [paused, setPaused] = useState(false);
  const [secs, setSecs] = useState(0);
  const [parts, setParts] = useState<Part[]>([]);
  const [drag, setDrag] = useState<Rect | null>(null);
  const rec = useRef<MediaRecorder | null>(null);
  const streams = useRef<MediaStream[]>([]);
  const out = useRef<MediaStream | null>(null);
  const audioCtx = useRef<AudioContext | null>(null);
  const dest = useRef<MediaStreamAudioDestinationNode | null>(null);
  const display = useRef<MediaStream | null>(null);
  const cropTimer = useRef<ReturnType<typeof setInterval>>(undefined);
  const elapsed = useRef(0);
  const lastTick = useRef(0);
  const segStart = useRef(0);
  const stopping = useRef(false);
  const pausedRef = useRef(false);
  const group = useRef('');
  const counter = useRef(0);
  const queue = useRef<Promise<void>>(Promise.resolve());
  const timer = useRef<ReturnType<typeof setInterval>>(undefined);
  const origin = useRef<{ x: number; y: number } | null>(null);
  useEffect(() => {
    if (state !== 'rec') return;
    const t = setInterval(() => {
      const now = Date.now();
      if (!pausedRef.current) elapsed.current += now - lastTick.current;
      lastTick.current = now; setSecs(Math.round(elapsed.current / 1000));
    }, 1000);
    return () => clearInterval(t);
  }, [state]);
  useEffect(() => () => { clearInterval(timer.current); clearInterval(cropTimer.current); }, []);
  if (!canDisplayCapture()) return null;

  const fps = hq ? 30 : 24;
  const bitrate = hq ? 3_000_000 : 1_200_000;
  const filenameOf = (n: number) => `Grabación - ${title} - ${new Date().toLocaleDateString('es-CL')} - parte ${n}.webm`.replace(/[\\/:*?"<>|]/g, '-');
  const patch = (n: number, p: Partial<Part>) => setParts((ps) => ps.map((x) => (x.n === n ? { ...x, ...p } : x)));

  const save = (n: number, blob: Blob, dur: number) => {
    setParts((ps) => [...ps, { n, secs: dur, size: blob.size, status: 'subiendo', blob }]);
    queue.current = queue.current.then(async () => {
      try {
        const id = await uploadRecording(sessionId, blob, { filename: filenameOf(n), duration: dur, group: group.current, part: n });
        patch(n, { status: 'guardada', id, blob: undefined }); // libera memoria: ya está en la plataforma
      } catch (e) { patch(n, { status: 'error', error: (e as Error).message }); }
    });
  };

  const cleanup = () => {
    clearInterval(timer.current); clearInterval(cropTimer.current);
    streams.current.forEach((x) => x.getTracks().forEach((t) => t.stop())); streams.current = [];
    audioCtx.current?.close().catch(() => {}); audioCtx.current = null;
  };

  const startSegment = () => {
    const mime = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'].find((m) => MediaRecorder.isTypeSupported(m)) ?? '';
    const r = new MediaRecorder(out.current!, { mimeType: mime, videoBitsPerSecond: bitrate });
    const chunks: Blob[] = [];
    const n = ++counter.current; segStart.current = elapsed.current;
    r.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
    r.onstop = () => {
      const dur = Math.max(1, Math.round((elapsed.current - segStart.current) / 1000));
      if (chunks.length) save(n, new Blob(chunks, { type: 'video/webm' }), dur);
      if (!stopping.current) { startSegment(); return; }
      cleanup(); broadcast(false); setState('finishing');
      queue.current.then(() => setState('done'));
    };
    r.start(5000); rec.current = r;
  };

  const beginRecording = (video: MediaStreamTrack) => {
    out.current = new MediaStream([video, ...dest.current!.stream.getAudioTracks()]);
    group.current = crypto.randomUUID(); counter.current = 0; stopping.current = false; pausedRef.current = false; setPaused(false); setParts([]);
    elapsed.current = 0; lastTick.current = Date.now(); setSecs(0);
    startSegment();
    // Rota la parte cada 2 minutos de grabación efectiva (no mientras está en pausa)
    timer.current = setInterval(() => {
      if (rec.current?.state === 'recording' && elapsed.current - segStart.current >= ((globalThis as { __sematecSegmentMs?: number }).__sematecSegmentMs ?? SEGMENT_MS)) rec.current.stop();
    }, 1000);
    setState('rec'); broadcast(true);
    say('🔴 Grabando: se guarda en la plataforma cada 2 minutos. Todos ven el aviso.');
  };

  /** Mezcla el micrófono propio y el audio de los participantes (o el de la pantalla capturada). */
  const audioMix = async (captured?: MediaStream) => {
    const ctx = new AudioContext(); const d = ctx.createMediaStreamDestination(); audioCtx.current = ctx; dest.current = d;
    if (captured?.getAudioTracks().length) ctx.createMediaStreamSource(captured).connect(d);
    else {
      // sin audio capturado: se graba el audio de la clase directamente desde la sala
      room.remoteParticipants.forEach((p) => p.audioTrackPublications.forEach((pub) => {
        const t = pub.track?.mediaStreamTrack; if (t) ctx.createMediaStreamSource(new MediaStream([t])).connect(d);
      }));
    }
    try { const mic = await navigator.mediaDevices.getUserMedia({ audio: true }); streams.current.push(mic); ctx.createMediaStreamSource(mic).connect(d); } catch { /* sin micrófono */ }
  };

  const start = async () => {
    try {
      if (mode === 'shared') {
        const pub = [...room.remoteParticipants.values(), room.localParticipant].flatMap((p) => [...p.trackPublications.values()])
          .find((x) => x.source === Track.Source.ScreenShare && x.track);
        const t = pub?.track?.mediaStreamTrack;
        if (!t) { say('Nadie está compartiendo pantalla en este momento.'); return; }
        await audioMix();
        t.addEventListener('ended', () => stop());
        beginRecording(t);
        return;
      }
      const video: Record<string, unknown> = { frameRate: mode === 'screen' ? 30 : fps };
      const opts: Record<string, unknown> = { audio: true, systemAudio: 'include', selfBrowserSurface: 'include', surfaceSwitching: 'include' };
      if (mode === 'tab' || mode === 'area') opts.preferCurrentTab = true;
      if (mode === 'screen') { video.displaySurface = 'monitor'; video.cursor = 'always'; opts.monitorTypeSurfaces = 'include'; }
      if (mode === 'choose') video.cursor = 'always';
      const cap = await navigator.mediaDevices.getDisplayMedia({ ...opts, video } as DisplayMediaStreamOptions);
      streams.current.push(cap); display.current = cap;
      await audioMix(cap);
      cap.getVideoTracks()[0].addEventListener('ended', () => stop());
      if (mode === 'area') { setDrag(null); setState('area'); return; } // primero marca el área
      beginRecording(cap.getVideoTracks()[0]);
    } catch (e) {
      cleanup();
      const n = (e as DOMException)?.name;
      say(n === 'NotAllowedError' ? 'Grabación cancelada (no se dio permiso para capturar la pantalla).'
        : n === 'NotReadableError' ? 'El sistema bloqueó la captura: en Mac active Chrome en «Privacidad → Grabación de pantalla».'
        : 'No se pudo iniciar la grabación en este navegador.');
      setState('idle');
    }
  };

  /** ✂ Recorta el área marcada: dibuja ese rectángulo de la captura en un lienzo y graba el lienzo. */
  const startArea = (r: Rect) => {
    const cap = display.current!; const track = cap.getVideoTracks()[0];
    const v = document.createElement('video'); v.muted = true; v.playsInline = true; v.srcObject = new MediaStream([track]);
    v.play().then(() => {
      const sx = (v.videoWidth || window.innerWidth) / window.innerWidth; const sy = (v.videoHeight || window.innerHeight) / window.innerHeight;
      const c = document.createElement('canvas');
      c.width = Math.max(2, Math.round(r.w * sx / 2) * 2); c.height = Math.max(2, Math.round(r.h * sy / 2) * 2);
      const g = c.getContext('2d')!;
      const draw = () => g.drawImage(v, r.x * sx, r.y * sy, r.w * sx, r.h * sy, 0, 0, c.width, c.height);
      draw(); cropTimer.current = setInterval(draw, Math.round(1000 / fps));
      const cs = c.captureStream(fps); streams.current.push(cs);
      beginRecording(cs.getVideoTracks()[0]);
    }).catch(() => { say('No se pudo preparar el área.'); stop(); });
  };

  const stop = () => {
    stopping.current = true;
    if (rec.current && rec.current.state !== 'inactive') rec.current.stop();
    else { cleanup(); broadcast(false); setState(counter.current ? 'finishing' : 'idle'); queue.current.then(() => setState(counter.current ? 'done' : 'idle')); }
  };
  const togglePause = () => {
    const r = rec.current; if (!r) return;
    if (r.state === 'recording') { r.pause(); pausedRef.current = true; setPaused(true); broadcast(false); say('⏸ Grabación en pausa: lo que pase ahora no se graba.'); }
    else if (r.state === 'paused') { r.resume(); pausedRef.current = false; lastTick.current = Date.now(); setPaused(false); broadcast(true); say('▶ Grabación reanudada.'); }
  };
  const download = (p: Part) => { if (!p.blob) return; const a = document.createElement('a'); a.href = URL.createObjectURL(p.blob); a.download = filenameOf(p.n); a.click(); };
  const mmss = (x: number) => `${Math.floor(x / 60)}:${String(x % 60).padStart(2, '0')}`;
  const saved = parts.filter((p) => p.status === 'guardada');
  const first = [...saved].sort((a, b) => a.n - b.n)[0];

  if (state === 'area') return (
    <div className="fixed inset-0 z-50 cursor-crosshair bg-black/30" data-testid="marcar-area"
      onMouseDown={(e) => { origin.current = { x: e.clientX, y: e.clientY }; setDrag({ x: e.clientX, y: e.clientY, w: 0, h: 0 }); }}
      onMouseMove={(e) => { const o = origin.current; if (!o) return; setDrag({ x: Math.min(o.x, e.clientX), y: Math.min(o.y, e.clientY), w: Math.abs(e.clientX - o.x), h: Math.abs(e.clientY - o.y) }); }}
      onMouseUp={() => { const r = drag; origin.current = null; if (!r || r.w < 40 || r.h < 40) { say('Marque un área más grande (arrastre el mouse).'); return; } startArea(r); }}>
      <p className="pointer-events-none absolute left-1/2 top-4 -translate-x-1/2 rounded-lg bg-black/80 px-4 py-2 text-sm">✂ Arrastre el mouse para marcar el área que quiere grabar · <button className="pointer-events-auto underline" onMouseDown={(e) => e.stopPropagation()} onClick={() => stop()}>Cancelar</button></p>
      {drag && <div className="pointer-events-none absolute border-2 border-red-500 bg-white/10" style={{ left: drag.x, top: drag.y, width: drag.w, height: drag.h }} />}
    </div>
  );
  if (state === 'rec') return (
    <span className="flex items-center gap-1">
      <button className="lk-button" style={{ background: paused ? '#b45309' : '#dc2626' }} onClick={stop} data-testid="detener-grabacion">
        ⏹ Detener ({mmss(secs)}{saved.length ? ` · ☁ ${saved.length}` : ''})</button>
      <button className="lk-button" onClick={togglePause} data-testid="pausar-grabacion">{paused ? '▶ Reanudar' : '⏸ Pausar'}</button>
    </span>);
  if (state === 'idle' || state === 'setup') return (
    <span className="relative">
      <button className="lk-button" onClick={() => setState(state === 'setup' ? 'idle' : 'setup')}>⏺ Grabar</button>
      {state === 'setup' && (
        <span className="absolute bottom-12 left-1/2 z-30 block w-[min(92vw,26rem)] -translate-x-1/2 rounded-xl bg-[#222] p-4 text-left text-sm shadow-2xl" data-testid="opciones-grabacion">
          <b>¿Qué quiere grabar?</b>
          {REC_MODES.map(([k, l, d]) => (
            <label key={k} className={`mt-2 flex cursor-pointer gap-2 rounded-lg p-2 ${mode === k ? 'bg-blue-600/30' : 'hover:bg-white/5'}`}>
              <input type="radio" name="modo-grabacion" value={k} checked={mode === k} onChange={() => setMode(k)} className="mt-1" />
              <span><span className="font-semibold">{l}</span><span className="block text-xs opacity-70">{d}</span></span>
            </label>))}
          <label className="mt-3 flex items-center gap-2 text-xs"><input type="checkbox" checked={hq} onChange={(e) => setHq(e.target.checked)} /> Alta calidad (más nítido y fluido; archivos más grandes)</label>
          <span className="mt-3 flex gap-2">
            <button className="rounded-lg bg-red-600 px-3 py-2 font-semibold" onClick={start}>⏺ Empezar a grabar</button>
            <button className="rounded-lg px-3 py-2 opacity-70" onClick={() => setState('idle')}>Cancelar</button>
          </span>
          <span className="mt-2 block text-xs opacity-60">Durante la grabación puede ⏸ pausar y ▶ reanudar para grabar solo las partes que quiera.</span>
        </span>)}
    </span>);
  return (
    <span className="fixed bottom-20 left-1/2 z-30 w-[92vw] max-w-md -translate-x-1/2 rounded-xl bg-[#222] p-4 text-sm shadow-2xl" data-testid="grabacion-lista">
      <b>{state === 'finishing' ? '⏳ Guardando las últimas partes…' : `🎬 Grabación guardada (${mmss(secs)})`}</b>
      <ul className="mt-2 space-y-1 text-xs">{parts.map((p) => (
        <li key={p.n} className="flex items-center justify-between gap-2">
          <span>Parte {p.n} · {mmss(p.secs)} · {(p.size / 1048576).toFixed(1)} MB</span>
          <span>{p.status === 'guardada' ? '☁ guardada' : p.status === 'subiendo' ? 'subiendo…'
            : <button className="underline" onClick={() => download(p)} title={p.error}>⚠ ⬇ Descargar</button>}</span>
        </li>))}</ul>
      <span className="mt-3 flex flex-wrap gap-2">
        {first && state === 'done' && <a className="rounded-lg bg-blue-600 px-3 py-2" href={`/app/conferencias/grabacion/${first.id}/editar`} target="_blank" rel="noopener noreferrer">✂ Unir, cortar, descargar o enviar</a>}
        <button className="rounded-lg px-3 py-2 opacity-70 hover:opacity-100" disabled={state === 'finishing'} onClick={() => { setParts([]); setState('idle'); }}>Cerrar</button>
      </span>
      {parts.some((p) => p.status === 'error') && <span className="mt-2 block text-xs text-amber-300">Las partes con ⚠ no se pudieron subir (revise el plan de almacenamiento): descárguelas en este equipo antes de cerrar.</span>}
    </span>
  );
}
