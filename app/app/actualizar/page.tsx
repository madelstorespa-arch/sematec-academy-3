import { APP_VERSION, APP_BUILT } from '@/lib/version.generated';
import { redirect } from 'next/navigation';
import { getContext } from '@/lib/context';
import { PageHeader, Card, Badge } from '@/components/ui';
import { ActionForm } from '@/components/forms';
import { fmtDateTime } from '@/lib/format';
import { MIGRATIONS } from '@/lib/setup/sql.generated';
import { installUpdates } from './actions';
import { ReloadButton } from './reload-button';

export const dynamic = 'force-dynamic';

const nice = (n: string) => n.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());

export default async function ActualizarPage() {
  const ctx = await getContext();
  if (!ctx.isPlatformAdmin) redirect('/app');
  const { data, error } = await ctx.supabase.rpc('installed_migrations');
  const installed = new Set((data ?? []) as string[]);
  const pending = MIGRATIONS.filter((m) => !installed.has(m.version));
  const hasDb = !!process.env.DATABASE_URL;
  const mfa = ctx.aal === 'aal2';
  return (
    <div>
      <PageHeader title="⬆ Actualizar el sistema" subtitle="Instale las mejoras nuevas con un botón y recargue la aplicación a la última versión." />
      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Versión de la aplicación">
          <p className="text-sm">Publicada: <b className="font-mono">{APP_VERSION}</b>
            {APP_BUILT && <span className="text-slate-500"> · {fmtDateTime(APP_BUILT)}</span>}</p>
          <p className="mt-2 text-sm text-slate-600">Vercel publica solo cada cambio nuevo. Si un equipo o celular muestra una versión antigua, recárguela aquí (o toque «Actualizar ahora» cuando aparezca el aviso).</p>
          <div className="mt-4"><ReloadButton /></div>
        </Card>
        <Card title="Mejoras de la base de datos">
          {error ? <p className="text-sm text-red-700">{error.message}</p> : pending.length === 0 ? (
            <p className="text-sm" data-testid="al-dia"><Badge color="green">✓ Al día</Badge> Todas las mejoras ({MIGRATIONS.length}) están instaladas.</p>
          ) : (
            <>
              <p className="mb-2 text-sm"><Badge color="amber">{pending.length} pendiente{pending.length > 1 ? 's' : ''}</Badge> Mejoras por instalar:</p>
              <ul className="mb-4 list-inside list-disc text-sm" data-testid="pendientes">{pending.map((m) => <li key={m.version}>{nice(m.name)}</li>)}</ul>
              {!hasDb ? (
                <div className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">
                  <p className="font-semibold">Para activar este botón (una sola vez):</p>
                  <ol className="ml-4 mt-1 list-decimal space-y-1">
                    <li>En Supabase → <b>Connect</b> → <b>Session pooler</b>, copie la dirección y ponga su contraseña de la base.</li>
                    <li>En Vercel → Settings → Environment Variables, cree <code>DATABASE_URL</code> con esa dirección.</li>
                    <li>Deployments → ⋯ → <b>Redeploy</b>. Desde entonces, cada actualización es solo tocar el botón aquí (ya no necesita SETUP_TOKEN).</li>
                  </ol>
                </div>
              ) : !mfa ? (
                <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">Por seguridad, cierre sesión y vuelva a entrar con el código de verificación en dos pasos para poder actualizar.</p>
              ) : (
                <ActionForm action={installUpdates} submitLabel={`⬆ Instalar ${pending.length} mejora${pending.length > 1 ? 's' : ''}`}
                  confirm="¿Instalar las mejoras ahora? Toma unos segundos; cada mejora se instala completa o no se instala.">
                  <p className="text-xs text-slate-500">Se recomienda hacerlo fuera del horario de clases.</p>
                </ActionForm>
              )}
            </>
          )}
        </Card>
      </div>
      <p className="mt-4 text-xs text-slate-500">Seguridad: la conexión a la base (DATABASE_URL) vive solo en el servidor de Vercel, nunca en el navegador ni en GitHub. Solo el superadministrador con verificación en dos pasos puede usar este botón.</p>
    </div>
  );
}
