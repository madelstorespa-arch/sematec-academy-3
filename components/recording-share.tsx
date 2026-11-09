'use client';
import { useState } from 'react';

/** Compartir el enlace de una grabación (requiere iniciar sesión: solo participantes autorizados pueden verla). */
export function RecordingShare({ id, title }: { id: string; title: string }) {
  const [copied, setCopied] = useState(false);
  const share = async () => {
    const url = `${location.origin}/app/conferencias/grabacion/${id}`;
    if (navigator.share) { await navigator.share({ title: `Grabación: ${title}`, text: `Grabación de la clase «${title}»`, url }).catch(() => {}); return; }
    await navigator.clipboard.writeText(url); setCopied(true); setTimeout(() => setCopied(false), 2000);
  };
  return <button type="button" className="btn-secondary btn-sm" onClick={share}>{copied ? '✓ Enlace copiado' : '📤 Compartir'}</button>;
}
