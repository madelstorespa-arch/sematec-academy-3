'use client';
export default function Error({ reset }: { error: Error; reset: () => void }) {
  return (
    <div className="card card-pad max-w-xl">
      <h1 className="text-xl font-bold">No se pudo cargar la información</h1>
      <p className="mt-2 text-sm text-slate-600">Puede deberse a un problema de conexión con el servidor. Ningún cambio pendiente fue guardado.</p>
      <button className="btn-primary mt-4" onClick={reset}>Reintentar</button>
    </div>
  );
}
