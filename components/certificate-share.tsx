'use client';
import { useState } from 'react';

/** Descargar el certificado en PDF y enviarlo (compartir del celular, WhatsApp o correo). */
export function CertificateShare({ id, title, recipient, verifyUrl, email }: {
  id: string; title: string; recipient: string; verifyUrl: string; email?: string | null;
}) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const pdfUrl = `/app/certificados/${id}/pdf`;
  const text = `${title} — ${recipient}.\nVerifique su autenticidad aquí: ${verifyUrl}`;

  async function share() {
    setBusy(true); setMsg(null);
    try {
      const res = await fetch(pdfUrl);
      if (!res.ok) throw new Error();
      const blob = await res.blob();
      const file = new File([blob], `Certificado - ${recipient}.pdf`, { type: 'application/pdf' });
      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], title, text });
      } else if (navigator.share) {
        await navigator.share({ title, text, url: verifyUrl });
      } else {
        setMsg('Este navegador no permite compartir archivos: use «Descargar PDF» y luego WhatsApp o Correo.');
      }
    } catch (e) {
      if ((e as Error)?.name !== 'AbortError') setMsg('No se pudo preparar el PDF. Revise su conexión e intente de nuevo.');
    } finally { setBusy(false); }
  }

  return (
    <div className="print:hidden">
      <div className="flex flex-wrap items-center gap-2">
        <a className="btn-primary" href={pdfUrl} download>⬇ Descargar PDF</a>
        <button type="button" className="btn-secondary" onClick={share} disabled={busy}>{busy ? 'Preparando…' : '📤 Enviar'}</button>
        <a className="btn-secondary" target="_blank" rel="noopener noreferrer" href={`https://wa.me/?text=${encodeURIComponent(text)}`}>WhatsApp</a>
        <a className="btn-secondary" href={`mailto:${email ?? ''}?subject=${encodeURIComponent(title)}&body=${encodeURIComponent(`Estimado/a ${recipient}:\n\nAdjuntamos su ${title}.\n\nPuede verificar su autenticidad en: ${verifyUrl}\n\nSaludos cordiales.`)}`}>✉ Correo</a>
      </div>
      <p className="mt-2 text-xs text-slate-500">«Enviar» abre las apps del celular (WhatsApp, Gmail, Drive…) con el PDF adjunto. En el computador, descargue el PDF y adjúntelo en el correo que se abre.</p>
      {msg && <p className="mt-2 text-sm text-amber-800">{msg}</p>}
    </div>
  );
}
