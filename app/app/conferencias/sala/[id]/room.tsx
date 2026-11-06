'use client';
import '@livekit/components-styles';
import { useCallback, useState } from 'react';
import Link from 'next/link';
import { LiveKitRoom, VideoConference } from '@livekit/components-react';
import { CONF_ROLES } from '@/lib/format';

export function Room({ sessionId, title, recording }: { sessionId: string; title: string; recording: boolean }) {
  const [conn, setConn] = useState<{ token: string; url: string; role: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const join = useCallback(async () => {
    setBusy(true); setError(null);
    try {
      const r = await fetch('/api/livekit/token', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ session: sessionId }) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? 'No se pudo obtener acceso');
      setConn(j);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Sin conexión con el servidor');
    } finally { setBusy(false); }
  }, [sessionId]);

  if (!conn) {
    return (
      <div className="mx-auto mt-10 max-w-lg card card-pad text-center">
        <h1 className="text-xl font-bold">{title}</h1>
        <p className="mt-2 text-sm text-slate-600">Al entrar, el navegador solicitará permiso para usar cámara y micrófono.</p>
        {recording && <p className="mt-2 rounded bg-amber-50 p-2 text-sm text-amber-800">Esta sesión puede ser grabada por el organizador.</p>}
        <button onClick={join} disabled={busy} className="btn-primary mt-5">{busy ? 'Conectando…' : 'Entrar a la sala'}</button>
        {error && <p className="mt-4 rounded bg-red-50 p-2 text-sm text-red-700">{error}</p>}
        <p className="mt-4"><Link className="link text-sm" href={`/app/conferencias/${sessionId}`}>Detalle de la sesión</Link></p>
      </div>
    );
  }
  return (
    <div data-lk-theme="default" className="fixed inset-0 z-50 flex flex-col bg-black lg:left-64">
      <div className="flex items-center justify-between px-4 py-2 text-sm text-white">
        <span className="font-semibold">{title}</span><span className="text-xs opacity-70">Rol: {CONF_ROLES[conn.role] ?? conn.role}</span>
      </div>
      <LiveKitRoom serverUrl={conn.url} token={conn.token} connect video={false} audio={false}
        onDisconnected={() => setConn(null)} onError={(e) => setError(e.message)} style={{ flex: 1, minHeight: 0 }}>
        <VideoConference />
      </LiveKitRoom>
    </div>
  );
}
