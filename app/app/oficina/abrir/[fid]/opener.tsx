'use client';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { importToOffice } from '@/components/office/import';

/** Abre un archivo de «Mis archivos» (Word, Excel, PowerPoint…) en el editor de SEMATEC Oficina. */
export function Opener({ fid, name, mime }: { fid: string; name: string; mime: string }) {
  const router = useRouter();
  const [err, setErr] = useState<string | null>(null);
  const once = useRef(false);
  useEffect(() => {
    if (once.current) return; once.current = true;
    (async () => {
      try {
        const r = await fetch(`/app/archivos/ver/${fid}?descargar=1`);
        if (!r.ok) throw new Error('No se pudo leer el archivo.');
        const blob = await r.blob();
        const res = await importToOffice(new Blob([blob], { type: mime }), name);
        if (res.ok && res.id) router.replace(`/app/oficina/${res.id}`); else setErr(res.error ?? 'No se pudo abrir.');
      } catch (e) { setErr((e as Error).message); }
    })();
  }, [fid, name, mime, router]);
  return <div className="card card-pad">{err ? <p className="text-red-600">{err}</p> : <p>Abriendo «{name}» en SEMATEC Oficina… (se crea una copia editable; el original no cambia)</p>}</div>;
}
