import Link from 'next/link';
import { getContext } from '@/lib/context';
import { PageHeader, Card, Badge } from '@/components/ui';
import { ActionForm, Field, Grid, SelectField } from '@/components/forms';
import { DOC_TYPES } from '@/lib/identity';
import { changePassword, signOutEverywhere } from '@/app/login/actions';
import { updateProfile, uploadAvatar } from './actions';

export const metadata = { title: 'Mi cuenta' };

export default async function Page() {
  const ctx = await getContext();
  const p = ctx.profile;
  return (
    <>
      <PageHeader title="Mi cuenta" subtitle={`${ctx.user.email ?? ''}${p?.user_code ? ` · Código ${p.user_code}` : ''}`} />
      {(!p?.full_name || !p?.id_document_number) && (
        <p className="mb-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800" data-testid="falta-identidad">
          🪪 Complete su <b>nombre y RUT</b>: se registran en cada venta, compra o cambio que haga en SEMATEC VENTA, y le permiten entrar al sistema con su RUT.</p>)}
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
        <Card title="🪪 Datos personales e identificación">
          {p?.user_code && <p className="mb-3 text-sm">Su código de usuario: <Badge color="blue">{p.user_code}</Badge></p>}
          <ActionForm action={updateProfile} submitLabel="Guardar" resetOnSuccess={false}>
            <Grid><Field label="Nombre completo" name="full_name" required defaultValue={p?.full_name} />
              <SelectField label="Documento" name="id_document_type" required defaultValue={p?.id_document_type ?? 'RUN'} options={DOC_TYPES.map(([value, label]) => ({ value, label }))} />
              <Field label="RUT o N° de pasaporte" name="id_document_number" required defaultValue={p?.id_document_number} placeholder="12.345.678-5" />
              <Field label="Teléfono" name="phone" defaultValue={p?.phone} />
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
