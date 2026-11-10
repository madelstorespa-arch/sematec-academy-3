'use client';
import { useEffect, useState } from 'react';
import { DOC_TYPES } from '@/lib/identity';
import { RoomShell } from '@/app/app/conferencias/sala/[id]/room';
import type { Conn } from '@/components/conference/context';

type Joined = Conn & { title: string; sessionId: string; orgId: string; chat: boolean };
const KEY = 'sematec-invitado';

/** Formulario del invitado (nombre, RUT/pasaporte, cargo, institución) y la sala. */
export function GuestJoin({ token, requireDocument, title }: { token: string; requireDocument: boolean; title: string }) {
  const [saved, setSaved] = useState<Record<string, string>>({});
  const [ready, setReady] = useState(0);
  useEffect(() => { try { setSaved(JSON.parse(localStorage.getItem(KEY) ?? '{}')); setReady(1); } catch { /* */ } }, []);
  const [joined, setJoined] = useState<Joined | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [left, setLeft] = useState(false);
  const [waiting, setWaiting] = useState(false);

  if (joined) return (
    <RoomShell conn={joined} view="full" onLeave={() => { setJoined(null); setLeft(true); }} onError={(m) => { setError(m); setJoined(null); }}
      opts={{ sessionId: joined.sessionId, title: joined.title, recording: false, chatEnabled: joined.chat, orgId: joined.orgId, sectionId: null, guest: true }} />
  );
  if (waiting) return (
    <div className="mt-6 rounded-xl bg-blue-50 p-6 text-center text-blue-900" data-testid="sala-espera">
      <p className="text-3xl">⏳</p>
      <p className="mt-2 font-semibold">Está en la sala de espera</p>
      <p className="mt-1 text-sm">El anfitrión lo dejará entrar en un momento. No cierre esta página.</p>
    </div>
  );
  return (
    <form key={ready} className="mt-6 space-y-3" data-testid="form-invitado" onSubmit={async (e) => {
      e.preventDefault(); setBusy(true); setError(null);
      const f = Object.fromEntries(new FormData(e.currentTarget).entries()) as Record<string, string>;
      try { localStorage.setItem(KEY, JSON.stringify({ name: f.name, doc_type: f.doc_type, doc_number: f.doc_number, cargo: f.cargo, institution: f.institution, email: f.email, phone: f.phone })); } catch { /* */ }
      try {
        const r = await fetch('/api/livekit/invitado', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...f, token, consent: f.consent === 'on' }) });
        const j = await r.json();
        if (r.status === 202 && j.waiting) {
          // ⏳ Sala de espera: pregunta cada 3 segundos si el anfitrión ya lo admitió
          setWaiting(true);
          for (;;) {
            await new Promise((ok) => setTimeout(ok, 3000));
            const w = await fetch('/api/livekit/invitado/espera', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ guest: j.guest, invite: j.invite }) });
            const k = await w.json().catch(() => ({}));
            if (w.status === 202) continue;
            setWaiting(false);
            if (!w.ok) throw new Error(k.error ?? 'No se pudo entrar.');
            setJoined(k); setLeft(false); return;
          }
        }
        if (!r.ok) throw new Error(j.error ?? 'No se pudo entrar.');
        setJoined(j); setLeft(false);
      } catch (err) { setWaiting(false); setError((err as Error).message); } finally { setBusy(false); }
    }}>
      {left && <p className="rounded-lg bg-slate-100 p-3 text-sm">Salió de «{title}». Puede volver a entrar cuando quiera.</p>}
      <label className="block"><span className="label">Nombre completo *</span><input name="name" required minLength={3} maxLength={120} defaultValue={saved.name} className="input" autoComplete="name" /></label>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block"><span className="label">Documento {requireDocument && '*'}</span>
          <select name="doc_type" defaultValue={saved.doc_type ?? 'RUN'} className="input">{DOC_TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
        <label className="block"><span className="label">N° (RUT, pasaporte…) {requireDocument && '*'}</span>
          <input name="doc_number" required={requireDocument} maxLength={30} defaultValue={saved.doc_number} className="input" placeholder="12.345.678-5" /></label>
        <label className="block"><span className="label">Cargo</span><input name="cargo" maxLength={120} defaultValue={saved.cargo} className="input" placeholder="Ej.: Gerente, apoderado, docente" /></label>
        <label className="block"><span className="label">Institución / empresa</span><input name="institution" maxLength={160} defaultValue={saved.institution} className="input" /></label>
        <label className="block"><span className="label">Correo</span><input name="email" type="email" maxLength={200} defaultValue={saved.email} className="input" autoComplete="email" /></label>
        <label className="block"><span className="label">Teléfono</span><input name="phone" maxLength={40} defaultValue={saved.phone} className="input" autoComplete="tel" /></label>
      </div>
      <label className="flex items-start gap-2 text-xs text-slate-600"><input type="checkbox" name="consent" required className="mt-0.5" /> Acepto que mis datos se registren para el control de asistencia de esta sesión.</label>
      {error && <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700" role="alert" data-testid="error-invitado">{error}</p>}
      <button className="btn-primary w-full py-3 text-base" disabled={busy}>{busy ? 'Conectando…' : '🎥 Entrar a la sala'}</button>
      <p className="text-center text-xs text-slate-500">El navegador pedirá permiso para cámara y micrófono. Puede entrar con ambos apagados.</p>
    </form>
  );
}
