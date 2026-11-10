import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="card card-pad max-w-xl" data-testid="no-encontrado">
      <p className="text-3xl">🔎</p>
      <h1 className="mt-2 text-xl font-bold">No encontramos lo que busca</h1>
      <p className="mt-2 text-sm text-slate-600">El registro no existe, fue eliminado o usted no tiene permiso para verlo.</p>
      <div className="mt-4 flex gap-2"><Link className="btn-primary" href="/app">⌂ Ir al inicio</Link></div>
    </div>
  );
}
