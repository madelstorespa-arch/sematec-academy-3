'use client';
/** Último respaldo: aunque falle todo el diseño, la persona ve un mensaje y puede recargar. */
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="es"><body style={{ fontFamily: 'system-ui, sans-serif', background: '#f1f5f9', margin: 0 }}>
      <main style={{ maxWidth: 480, margin: '80px auto', background: '#fff', borderRadius: 16, padding: 32, textAlign: 'center' }}>
        <p style={{ fontSize: 40, margin: 0 }}>🛠</p>
        <h1 style={{ fontSize: 20 }}>El sistema se está recuperando</h1>
        <p style={{ color: '#475569', fontSize: 14 }}>Ocurrió un problema inesperado. Sus datos están seguros. Toque «Reintentar».</p>
        {error.digest && <p style={{ color: '#94a3b8', fontSize: 12 }}>Código: {error.digest}</p>}
        <button onClick={() => { try { reset(); } catch { location.reload(); } }} style={{ background: '#1d4ed8', color: '#fff', border: 0, borderRadius: 8, padding: '10px 18px', fontWeight: 600 }}>Reintentar</button>
      </main>
    </body></html>
  );
}
