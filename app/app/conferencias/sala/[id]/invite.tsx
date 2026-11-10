'use client';
import { useCallback, useEffect, useState } from 'react';
import { createInvite, listInvites, revokeInvite, type InviteInfo } from '@/app/app/conferencias/invite-actions';

/** Botones para copiar y compartir un enlace de invitado. */
export function ShareLink({ url, title, dark = true }: { url: string; title: string; dark?: boolean }) {
  const [copied, setCopied] = useState(false);
  const text = `Le invito a «${title}». Entre aquí con su nombre y documento: ${url}`;
  const cls = dark ? 'rounded-lg bg-white/10 px-2 py-1 hover:bg-white/20' : 'btn-secondary btn-sm';
  return (
    <div className="space-y-2">
      <input readOnly value={url} className={dark ? 'w-full rounded-lg bg-black/40 px-2 py-1.5 font-mono text-[11px]' : 'input font-mono text-xs'} onFocus={(e) => e.target.select()} data-testid="enlace-invitado" />
      <div className="flex flex-wrap gap-1 text-xs">
        <button type="button" className={cls} onClick={async () => { try { await navigator.clipboard.writeText(url); } catch { /* */ } setCopied(true); setTimeout(() => setCopied(false), 2500); }}>{copied ? '✓ Copiado' : '📋 Copiar enlace'}</button>
        <a className={cls} href={`https://wa.me/?text=${encodeURIComponent(text)}`} target="_blank" rel="noopener noreferrer">📲 WhatsApp</a>
        <a className={cls} href={`mailto:?subject=${encodeURIComponent(`Invitación: ${title}`)}&body=${encodeURIComponent(text)}`}>✉ Correo</a>
        {typeof navigator !== 'undefined' && 'share' in navigator && <button type="button" className={cls} onClick={() => navigator.share({ title, text, url }).catch(() => {})}>↗ Compartir</button>}
      </div>
    </div>
  );
}

/** Panel «🔗 Invitar» dentro de la sala (anfitrión / moderador). */
export function InvitePanel({ sessionId, title }: { sessionId: string; title: string }) {
  const [list, setList] = useState<InviteInfo[] | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => listInvites(sessionId).then(setList).catch(() => setList([])), [sessionId]);
  useEffect(() => { load(); }, [load]);
  return (
    <div className="flex-1 space-y-4 overflow-y-auto p-3 text-sm" data-testid="invitar-panel">
      <p className="text-xs opacity-80">Personas sin cuenta en el sistema (apoderados, expositores, empresas…) entran con el enlace indicando su <b>nombre, RUT o pasaporte, cargo e institución</b>. Quedan registradas en el detalle de la sesión.</p>
      {list?.map((i) => (
        <div key={i.id} className="rounded-xl bg-white/5 p-3">
          <p className="mb-2 text-xs opacity-70">{i.label ? `${i.label} · ` : ''}Vence {new Date(i.expires_at).toLocaleString('es-CL', { dateStyle: 'short', timeStyle: 'short' })} · {i.uses}{i.max_uses ? `/${i.max_uses}` : ''} ingreso(s){i.allow_share ? ' · pueden compartir pantalla' : ''}</p>
          <ShareLink url={i.url} title={title} />
          <button className="mt-2 text-xs text-red-300 underline" onClick={async () => { const fd = new FormData(); fd.set('id', i.id); fd.set('session_id', sessionId); const r = await revokeInvite(fd); setMsg(r.ok ? r.message ?? null : r.error ?? null); load(); }}>Desactivar enlace</button>
        </div>))}
      <form className="space-y-2 rounded-xl border border-white/10 p-3" onSubmit={async (e) => {
        e.preventDefault(); setBusy(true); setMsg(null);
        const fd = new FormData(e.currentTarget); fd.set('session_id', sessionId);
        const r = await createInvite(fd); setBusy(false);
        setMsg(r.ok ? r.message ?? null : r.error ?? 'No se pudo crear el enlace.'); if (r.ok) load();
      }}>
        <b className="block text-xs">{list?.length ? '➕ Otro enlace' : '➕ Crear enlace de invitado'}</b>
        <label className="block text-xs opacity-80">Válido por
          <select name="hours" defaultValue="24" className="mt-1 w-full rounded-lg bg-white/10 px-2 py-1.5">
            <option value="2">2 horas</option><option value="24">1 día</option><option value="168">1 semana</option><option value="720">30 días</option></select></label>
        <label className="block text-xs opacity-80">Máximo de personas (opcional)
          <input name="max_uses" type="number" min={1} max={1000} className="mt-1 w-full rounded-lg bg-white/10 px-2 py-1.5" placeholder="Sin límite" /></label>
        <label className="flex items-center gap-2 text-xs"><input type="checkbox" name="allow_share" /> Pueden compartir su pantalla</label>
        <label className="flex items-center gap-2 text-xs"><input type="checkbox" name="require_document" defaultChecked /> Pedir RUT o pasaporte</label>
        <button className="w-full rounded-lg bg-blue-600 py-2 font-semibold disabled:opacity-50" disabled={busy} data-testid="crear-enlace">{busy ? 'Creando…' : '🔗 Crear enlace'}</button>
      </form>
      {msg && <p className="rounded-lg bg-white/10 p-2 text-xs" role="status">{msg}</p>}
    </div>
  );
}
