'use client';
import { useRef, useState } from 'react';
import { uploadRecording } from '@/lib/recordings-client';

type Part = { id: string; part_no: number | null; filename: string | null };

const t2s = (t: string) => { const p = t.trim().split(':').map(Number); if (p.some(isNaN)) return NaN; return p.reduce((a, b) => a * 60 + b, 0); };
const s2t = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

/**
 * ✂ Editor de grabaciones (solo personas autorizadas): corta un tramo o une las partes de la clase,
 * todo dentro del navegador con FFmpeg (WebAssembly). El resultado se descarga o se guarda como nueva grabación.
 */
export function VideoEditor({ recId, sessionId, title, parts }: { recId: string; sessionId: string; title: string; parts: Part[] }) {
  const video = useRef<HTMLVideoElement>(null);
  const ff = useRef<any>(null);
  const [from, setFrom] = useState('0:00');
  const [to, setTo] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [result, setResult] = useState<{ blob: Blob; url: string; name: string } | null>(null);

  const load = async () => {
    if (ff.current) return ff.current;
    setBusy('Cargando el editor (solo la primera vez, ~30 MB)…');
    const { FFmpeg } = await import('@ffmpeg/ffmpeg');
    const f = new FFmpeg();
    await f.load({ classWorkerURL: `${location.origin}/ffmpeg/worker/worker.js`, coreURL: `${location.origin}/ffmpeg/esm/ffmpeg-core.js`, wasmURL: `${location.origin}/ffmpeg/esm/ffmpeg-core.wasm` });
    ff.current = f; return f;
  };
  const fetchVideo = async (id: string) => {
    const r = await fetch(`/app/conferencias/grabacion/${id}?descargar=1`);
    if (!r.ok) throw new Error(r.status === 403 ? 'No tiene autorización para editar esta grabación.' : 'No se pudo leer la grabación.');
    return new Uint8Array(await r.arrayBuffer());
  };
  const finish = async (f: any, name: string) => {
    const data = await f.readFile('out.webm') as Uint8Array;
    const blob = new Blob([data.slice().buffer as ArrayBuffer], { type: 'video/webm' });
    if (blob.size < 1000) throw new Error('El resultado quedó vacío: revise los tiempos de inicio y fin.');
    setResult({ blob, url: URL.createObjectURL(blob), name });
  };

  const cut = async () => {
    const a = t2s(from); const b = to ? t2s(to) : NaN;
    if (isNaN(a) || (to && (isNaN(b) || b <= a))) { setMsg({ ok: false, text: 'Revise los tiempos: use minutos:segundos y el fin debe ser mayor que el inicio.' }); return; }
    setMsg(null); setResult(null);
    try {
      const f = await load();
      setBusy('Leyendo la grabación…'); await f.writeFile('in.webm', await fetchVideo(recId));
      setBusy('✂ Cortando…');
      await f.exec(['-i', 'in.webm', '-ss', String(a), ...(to ? ['-to', String(b)] : []), '-c', 'copy', '-y', 'out.webm']);
      await finish(f, `${title} - recorte ${s2t(a)}${to ? `-${s2t(b)}` : ''}.webm`.replace(/[\\/:*?"<>|]/g, '-'));
      setMsg({ ok: true, text: 'Recorte listo: revíselo abajo y descárguelo o guárdelo.' });
    } catch (e) { console.error('[editor]', e); setMsg({ ok: false, text: (e as Error)?.message || `No se pudo cortar el video (${String(e)}).` }); }
    finally { setBusy(null); }
  };

  const join = async () => {
    setMsg(null); setResult(null);
    try {
      const f = await load();
      const list: string[] = [];
      for (const [i, p] of parts.entries()) {
        setBusy(`Leyendo parte ${i + 1} de ${parts.length}…`);
        await f.writeFile(`p${i}.webm`, await fetchVideo(p.id)); list.push(`file 'p${i}.webm'`);
      }
      await f.writeFile('list.txt', new TextEncoder().encode(list.join('\n')));
      setBusy('🔗 Uniendo las partes…');
      await f.exec(['-f', 'concat', '-safe', '0', '-i', 'list.txt', '-c', 'copy', '-y', 'out.webm']);
      await finish(f, `${title} - clase completa.webm`.replace(/[\\/:*?"<>|]/g, '-'));
      setMsg({ ok: true, text: `Se unieron ${parts.length} partes: revise el video abajo y descárguelo o guárdelo.` });
    } catch (e) { console.error('[editor]', e); setMsg({ ok: false, text: (e as Error)?.message || `No se pudieron unir las partes (${String(e)}).` }); }
    finally { setBusy(null); }
  };

  const save = async () => {
    if (!result) return;
    setBusy('Guardando en la plataforma…');
    try {
      const d = await new Promise<number>((res) => { const v = document.createElement('video'); v.preload = 'metadata'; v.onloadedmetadata = () => res(Number.isFinite(v.duration) ? v.duration : 0); v.onerror = () => res(0); v.src = result.url; });
      await uploadRecording(sessionId, result.blob, { filename: result.name, duration: Math.round(d), source: recId });
      setMsg({ ok: true, text: '✓ Guardado como nueva grabación en la sesión.' });
    } catch (e) { setMsg({ ok: false, text: (e as Error).message }); }
    finally { setBusy(null); }
  };
  const download = () => { if (!result) return; const a = document.createElement('a'); a.href = result.url; a.download = result.name; a.click(); };
  const send = async () => {
    const url = `${location.origin}/app/conferencias/grabacion/${recId}/ver`;
    if (navigator.share) await navigator.share({ title: `Grabación: ${title}`, text: `Grabación de «${title}» (requiere iniciar sesión)`, url }).catch(() => {});
    else { await navigator.clipboard.writeText(url).catch(() => {}); setMsg({ ok: true, text: 'Enlace copiado: péguelo en un correo o mensaje. Solo lo abren participantes con su cuenta.' }); }
  };

  return (
    <div className="space-y-5">
      <video ref={video} src={`/app/conferencias/grabacion/${recId}`} controls preload="metadata" className="max-h-[60vh] w-full rounded-xl bg-black" />
      <div className="flex flex-wrap items-end gap-2">
        <label className="block"><span className="label">Desde (min:seg)</span><input className="input w-28" value={from} onChange={(e) => setFrom(e.target.value)} data-testid="corte-desde" /></label>
        <button type="button" className="btn-secondary btn-sm" onClick={() => setFrom(s2t(video.current?.currentTime ?? 0))}>⏱ Inicio aquí</button>
        <label className="block"><span className="label">Hasta (min:seg, vacío = final)</span><input className="input w-28" value={to} onChange={(e) => setTo(e.target.value)} data-testid="corte-hasta" /></label>
        <button type="button" className="btn-secondary btn-sm" onClick={() => setTo(s2t(video.current?.currentTime ?? 0))}>⏱ Fin aquí</button>
        <button type="button" className="btn-primary" disabled={!!busy} onClick={cut}>✂ Cortar</button>
        {parts.length > 1 && <button type="button" className="btn-primary" disabled={!!busy} onClick={join}>🔗 Unir las {parts.length} partes</button>}
      </div>
      <div className="flex flex-wrap gap-2">
        <a className="btn-secondary" href={`/app/conferencias/grabacion/${recId}?descargar=1`}>⬇ Descargar original</a>
        <button type="button" className="btn-secondary" onClick={send}>📤 Enviar enlace</button>
      </div>
      {busy && <p className="text-sm text-slate-600" data-testid="editor-ocupado">⏳ {busy}</p>}
      {msg && <p role="status" className={`rounded-lg p-3 text-sm ${msg.ok ? 'bg-emerald-50 text-emerald-800' : 'bg-red-50 text-red-700'}`}>{msg.ok ? '' : '✕ '}{msg.text}</p>}
      {result && (
        <div className="space-y-2 rounded-xl border border-slate-200 p-4" data-testid="resultado-video">
          <p className="text-sm font-semibold">Resultado · {(result.blob.size / 1048576).toFixed(1)} MB</p>
          <video src={result.url} controls className="max-h-[40vh] w-full rounded-lg bg-black" />
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn-secondary" onClick={download}>⬇ Descargar</button>
            <button type="button" className="btn-primary" disabled={!!busy} onClick={save}>☁ Guardar como nueva grabación</button>
          </div>
        </div>)}
    </div>
  );
}
