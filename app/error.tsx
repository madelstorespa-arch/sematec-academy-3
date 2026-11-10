'use client';
export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="mx-auto mt-16 max-w-lg rounded-2xl bg-white p-8 text-center shadow" role="alert">
      <p className="text-4xl">🛠</p>
      <h1 className="mt-2 text-xl font-bold">La página tuvo un problema</h1>
      <p className="mt-2 text-sm text-slate-600">Intente nuevamente en unos segundos.</p>
      {error.digest && <p className="mt-2 text-xs text-slate-400">Código: {error.digest}</p>}
      <div className="mt-5 flex justify-center gap-2"><button className="btn-primary" onClick={reset}>Reintentar</button><a className="btn-secondary" href="/">Inicio</a></div>
    </main>
  );
}
