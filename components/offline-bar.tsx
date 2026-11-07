'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  OUTBOX_EVENT, setCurrentUser, myOutbox, failedItems, removeItem, markFailed, dismissFailed, toFormData,
  type OfflineKey, type OutboxItem, type FailedItem,
} from '@/lib/offline-queue';
import { saveAttendance, saveGrades } from '@/app/app/secciones/actions';
import { sendMessage } from '@/app/app/mensajes/actions';
import { createThread, replyThread } from '@/app/app/aula/actions';
import { openTicket, replyTicket } from '@/app/app/soporte/actions';
import { answerSurvey } from '@/app/app/encuestas/actions';
import { saveAlumniProfile } from '@/app/app/egresados/actions';

type Act = (fd: FormData) => Promise<{ ok: boolean; message?: string; error?: string }>;
const ACTIONS: Record<OfflineKey, Act> = {
  asistencia: saveAttendance, notas: saveGrades, mensaje: sendMessage, foro_tema: createThread, foro_respuesta: replyThread,
  soporte: openTicket, soporte_respuesta: replyTicket, encuesta: answerSurvey, egresado: saveAlumniProfile,
};
const WARM_EVERY = 6 * 3600 * 1000;

/**
 * Barra de estado sin conexión: avisa cuando no hay internet, envía la bandeja de salida
 * al volver la conexión, deja las páginas principales listas para usarse sin internet
 * y ofrece instalar SEMATEC como app.
 */
export function OfflineBar({ userId, warmUrls }: { userId: string; warmUrls: string[] }) {
  const router = useRouter();
  const [online, setOnline] = useState(true);
  const [pending, setPending] = useState<OutboxItem[]>([]);
  const [failed, setFailed] = useState<FailedItem[]>([]);
  const [syncing, setSyncing] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [installEvt, setInstallEvt] = useState<any>(null);
  const busy = useRef(false);

  const refresh = useCallback(() => { setPending(myOutbox()); setFailed(failedItems().filter((f) => f.userId === userId)); }, [userId]);

  const sync = useCallback(async () => {
    if (busy.current || !navigator.onLine) return;
    const items = myOutbox();
    if (!items.length) return;
    busy.current = true; setSyncing(true);
    let sent = 0;
    for (const item of items) {
      const act = ACTIONS[item.key];
      if (!act) { markFailed(item, 'Tipo de operación desconocido'); continue; }
      try {
        const r = await act(toFormData(item));
        if (r.ok) { removeItem(item.id); sent++; } else markFailed(item, r.error ?? 'Rechazado por el servidor');
      } catch {
        break; // la conexión volvió a caer: se reintenta después
      }
    }
    busy.current = false; setSyncing(false); refresh();
    if (sent) { setNote(`✓ ${sent} cambio(s) hechos sin conexión ya se guardaron en la nube.`); router.refresh(); }
  }, [refresh, router]);

  useEffect(() => {
    setCurrentUser(userId);
    setOnline(navigator.onLine);
    refresh();
    const on = () => { setOnline(true); sync(); };
    const off = () => setOnline(false);
    const onBip = (e: Event) => { e.preventDefault(); setInstallEvt(e); };
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    window.addEventListener(OUTBOX_EVENT, refresh);
    window.addEventListener('beforeinstallprompt', onBip);
    sync();
    const t = setInterval(sync, 60_000);
    return () => {
      window.removeEventListener('online', on); window.removeEventListener('offline', off);
      window.removeEventListener(OUTBOX_EVENT, refresh); window.removeEventListener('beforeinstallprompt', onBip); clearInterval(t);
    };
  }, [userId, refresh, sync]);

  // Deja listas sin conexión las páginas del menú (cada 6 horas, solo con internet)
  useEffect(() => {
    if (!('serviceWorker' in navigator) || !navigator.onLine) return;
    const k = `sematec-warm-${userId}`;
    let last = 0;
    try { last = Number(localStorage.getItem(k) || 0); } catch { /* */ }
    if (Date.now() - last < WARM_EVERY) return;
    const t = setTimeout(() => {
      navigator.serviceWorker.ready.then((reg) => {
        reg.active?.postMessage({ type: 'warm', urls: warmUrls });
        try { localStorage.setItem(k, String(Date.now())); } catch { /* */ }
      }).catch(() => {});
    }, 4000);
    return () => clearTimeout(t);
  }, [userId, warmUrls]);

  return (
    <div className="mb-4 space-y-2 empty:hidden print:hidden" data-testid="offline-bar">
      {!online && (
        <div className="rounded-lg bg-amber-100 px-4 py-2 text-sm text-amber-900">
          📴 <b>Sin conexión.</b> Está viendo la última copia guardada. Lo que registre (asistencia, notas, mensajes, encuestas…) se enviará solo al volver internet.
        </div>)}
      {pending.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-amber-50 px-4 py-2 text-sm text-amber-900 ring-1 ring-amber-200">
          <span>⏳ <b>{pending.length}</b> cambio(s) esperando conexión: {pending.slice(0, 3).map((p) => p.label).join(' · ')}{pending.length > 3 ? '…' : ''}</span>
          {online && <button className="btn-secondary btn-sm" onClick={sync} disabled={syncing}>{syncing ? 'Enviando…' : 'Enviar ahora'}</button>}
        </div>)}
      {failed.map((f) => (
        <div key={f.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-red-50 px-4 py-2 text-sm text-red-800 ring-1 ring-red-200">
          <span>✕ No se pudo guardar «{f.label}» (hecho sin conexión el {new Date(f.at).toLocaleString('es-CL')}): {f.error}. Vuelva a hacerlo en <a className="underline" href={f.path}>esta página</a>.</span>
          <button className="btn-secondary btn-sm" onClick={() => dismissFailed(f.id)}>Entendido</button>
        </div>))}
      {note && (
        <div className="flex items-center justify-between gap-2 rounded-lg bg-emerald-50 px-4 py-2 text-sm text-emerald-800">
          <span>{note}</span><button className="text-xs underline" onClick={() => setNote(null)}>Cerrar</button>
        </div>)}
      {installEvt && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-brand-50 px-4 py-2 text-sm text-brand-700">
          <span>📲 Instale SEMATEC en este dispositivo para abrirlo como app y usarlo también sin internet.</span>
          <span className="flex gap-2">
            <button className="btn-primary btn-sm" onClick={async () => { installEvt.prompt(); await installEvt.userChoice; setInstallEvt(null); }}>Instalar app</button>
            <button className="text-xs underline" onClick={() => setInstallEvt(null)}>Ahora no</button>
          </span>
        </div>)}
    </div>
  );
}

/** Botón de cierre de sesión: avisa si quedan cambios sin enviar y borra del dispositivo las páginas guardadas. */
export function LogoutButton({ className }: { className?: string }) {
  return (
    <form action="/auth/salir" method="post" onSubmit={(e) => {
      e.preventDefault();
      const form = e.currentTarget;
      const n = myOutbox().length;
      if (n && !window.confirm(`Tiene ${n} cambio(s) hechos sin conexión que aún no se envían. Si cierra sesión se enviarán la próxima vez que entre con esta cuenta. ¿Cerrar sesión igual?`)) return;
      const clear = 'caches' in window
        ? Promise.all([caches.delete('sematec-pages'), caches.delete('sematec-media')]).catch(() => {})
        : Promise.resolve();
      Promise.race([clear, new Promise((r) => setTimeout(r, 1500))]).then(() => form.submit());
    }}>
      <button className={className}>Cerrar sesión</button>
    </form>
  );
}
