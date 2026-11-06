import Link from 'next/link';
import { getContext } from '@/lib/context';
import { PageHeader, Card, Badge } from '@/components/ui';
import { ActionForm, Field, Grid } from '@/components/forms';
import { changePassword, signOutEverywhere } from '@/app/login/actions';
import { updateProfile, uploadAvatar } from './actions';

export const metadata = { title: 'Mi cuenta' };

export default async function Page() {
  const ctx = await getContext();
  const p = ctx.profile;
  return (
    <>
      <PageHeader title="Mi cuenta" subtitle={ctx.user.email ?? ''} />
      <div className="grid gap-6 xl:grid-cols-2">
        <Card title="Foto de perfil">
          <div className="flex items-center gap-5">
            {p?.avatar_asset_id
              // eslint-disable-next-line @next/next/no-img-element
              ? <img src={`/media/${p.avatar_asset_id}`} alt="Foto de perfil" className="h-24 w-24 rounded-full object-cover" />
              : <span className="grid h-24 w-24 place-items-center rounded-full bg-brand-50 text-3xl font-bold text-brand-700">{(p?.full_name || '?')[0]}</span>}
            <ActionForm action={uploadAvatar} submitLabel="Subir foto">
              <input type="file" name="file" accept="image/png,image/jpeg,image/webp" required className="text-sm" />
              <p className="text-xs text-slate-500">PNG, JPG o WebP, máximo 3 MB.</p>
            </ActionForm>
          </div>
        </Card>
        <Card title="Datos personales">
          <ActionForm action={updateProfile} submitLabel="Guardar" resetOnSuccess={false}>
            <Grid><Field label="Nombre completo" name="full_name" required defaultValue={p?.full_name} /><Field label="Teléfono" name="phone" defaultValue={p?.phone} />
              <Field label="Zona horaria" name="timezone" required defaultValue={p?.timezone} /></Grid>
          </ActionForm>
        </Card>
        <Card title="Seguridad">
          <p className="mb-3 text-sm">Verificación en dos pasos: {ctx.hasMfaFactor ? <Badge color="green">Activada</Badge> : <Badge color="amber">No configurada</Badge>}
            {!ctx.hasMfaFactor && <Link className="link ml-2" href="/mfa">Configurar ahora</Link>}</p>
          <ActionForm action={changePassword} submitLabel="Cambiar contraseña">
            <Grid><Field label="Nueva contraseña" name="password" type="password" required autoComplete="new-password" />
              <Field label="Repetir" name="confirm" type="password" required autoComplete="new-password" /></Grid>
          </ActionForm>
          <form action={signOutEverywhere} className="mt-5 border-t border-slate-100 pt-4">
            <p className="mb-2 text-sm text-slate-600">¿Perdió un dispositivo? Cierre todas sus sesiones activas.</p>
            <button className="btn-secondary">Cerrar sesión en todos los dispositivos</button>
          </form>
        </Card>
      </div>
    </>
  );
}
