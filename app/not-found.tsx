import Link from 'next/link';
export default function NotFound() {
  return (
    <main className="grid min-h-[60vh] place-items-center p-6 text-center">
      <div><p className="text-5xl font-black text-brand-600">404</p><h1 className="mt-2 text-xl font-bold">No encontrado o sin permiso</h1>
        <p className="mt-1 text-sm text-slate-500">El recurso no existe o su rol no tiene acceso.</p><Link className="btn-primary mt-5" href="/app">Ir al inicio</Link></div>
    </main>
  );
}
