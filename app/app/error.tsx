'use client';
import { useEffect } from 'react';
import Link from 'next/link';

/** Si una página falla, el resto del sistema sigue funcionando: se muestra un aviso claro y se puede reintentar. */
export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => { console.error('[pagina]', error); }, [error]);
  const offline = typeof navigator !== 'undefined' && !navigator.onLine;
  return (
    <div className="card card-pad max-w-xl" role="alert" data-testid="error-pagina">
      <p className="text-3xl">{offline ? '📡' : '🛠'}</p>
      <h1 className="mt-2 text-xl font-bold">{offline ? 'Sin conexión a internet' : 'Esta página tuvo un problema'}</h1>
      <p className="mt-2 text-sm text-slate-600">
        {offline ? 'Revise su conexión. Cuando vuelva, toque «Reintentar».' : 'No se perdió nada: los cambios que no se confirmaron no se guardaron. Puede reintentar o seguir usando el resto del sistema.'}
      </p>
      {error.digest && <p className="mt-2 text-xs text-slate-400">Código para soporte: {error.digest}</p>}
      <div className="mt-4 flex flex-wrap gap-2">
        <button className="btn-primary" onClick={reset}>🔄 Reintentar</button>
        <Link className="btn-secondary" href="/app">⌂ Ir al inicio</Link>
        <Link className="btn-secondary" href="/app/soporte">🛟 Avisar a soporte</Link>
      </div>
    </div>
  );
}
