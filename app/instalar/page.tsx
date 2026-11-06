import { InstallForm } from './install-form';
import { setupEnabled, installStatus } from '@/lib/setup/install';
import { runSetup } from './actions';

export const metadata = { title: 'Instalación', robots: { index: false } };
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export default async function Page() {
  if (!setupEnabled()) {
    return <Shell><p className="text-sm text-slate-600">El instalador está desactivado. Para usarlo, defina <code>DATABASE_URL</code> y <code>SETUP_TOKEN</code> en las variables de entorno del servidor.</p></Shell>;
  }
  let status: { installed: boolean; has_auth: boolean } | null = null; let err = '';
  try { status = await installStatus(); } catch (e) { err = (e as Error).message; }
  return (
    <Shell>
      {err && <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">No se pudo conectar a la base de datos: {err}. Revise DATABASE_URL (use la cadena «Session pooler» de Supabase).</p>}
      {status && !status.has_auth && <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">La base de datos no es un proyecto de Supabase (falta el esquema auth).</p>}
      {status?.installed && <p className="mb-4 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800">La base de datos ya está instalada. Puede aplicar migraciones nuevas o cargar los datos de demostración si faltan. Al terminar, elimine SETUP_TOKEN en Vercel.</p>}
      {status?.has_auth && <InstallForm action={runSetup} />}
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="mx-auto max-w-lg px-4 py-10">
      <p className="text-xs font-bold tracking-[0.3em] text-brand-600">SEMATEC ACADEMY</p>
      <h1 className="mt-1 text-2xl font-bold">Instalación de la base de datos</h1>
      <div className="mt-6">{children}</div>
    </main>
  );
}
