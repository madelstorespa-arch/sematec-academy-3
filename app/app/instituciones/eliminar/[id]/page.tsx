import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getContext } from '@/lib/context';
import { PageHeader, Card } from '@/components/ui';
import { ActionForm, Field } from '@/components/forms';
import { deleteOrganization } from '../../actions';

export const metadata = { title: 'Eliminar organización' };

type Preview = { id: string; slug: string; name: string; status: string; mode: string; is_member: boolean; members: number; rooms: number; sessions: number; recordings: number; students: number; files: number; payments: number; certificates: number };

/** 🗑 Eliminar una organización: resumen de lo que se borra y confirmación escribiendo su enlace. */
export default async function EliminarOrganizacion({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await getContext();
  if (!ctx.isPlatformAdmin) notFound();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const { data, error } = await ctx.supabase.rpc('organization_delete_preview', { p_org: id });
  if (error || !data) notFound();
  const o = data as Preview;
  const items: [string, number][] = [
    ['👥 Personas', o.members], ['🏫 Salas', o.rooms], ['🎥 Clases', o.sessions], ['⏺ Grabaciones', o.recordings],
    ['🎓 Estudiantes', o.students], ['📁 Archivos', o.files], ['💳 Pagos', o.payments], ['📜 Certificados', o.certificates],
  ];
  const blocked = o.status === 'active' ? 'Primero suspenda la organización en la lista (botón «Suspender»). Así sus miembros dejan de entrar y usted puede confirmar con calma.'
    : o.is_member ? 'Usted es miembro de esta organización: por seguridad no puede eliminarla desde aquí.'
    : o.id === ctx.orgId ? 'Es la organización con la que está trabajando ahora.' : null;
  return (
    <>
      <PageHeader title={`Eliminar «${o.name}»`} subtitle={`Enlace /o/${o.slug} · ${o.mode === 'aula' ? 'solo aula virtual' : 'sistema completo'}`} />
      <Card title="Se borrará todo esto, para siempre" className="mb-6">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4" data-testid="resumen-eliminar">
          {items.map(([l, n]) => <div key={l} className="rounded-lg bg-slate-50 p-3"><p className="text-xs text-slate-500">{l}</p><p className="text-xl font-bold">{n}</p></div>)}
        </div>
        <ul className="mt-4 list-disc space-y-1 pl-5 text-sm text-slate-700">
          <li>También sus clases, notas, mensajes, anuncios, configuración, marca y archivos guardados.</li>
          <li>No se puede deshacer. <b>Antes</b>, pida al propietario que descargue sus datos en <i>Configuración → Todo el sistema → ⬇ Exportar</i>.</li>
          <li>La auditoría de la plataforma guarda constancia de quién la eliminó y cuándo.</li>
          {o.payments > 0 && <li className="font-semibold text-red-700">Tiene {o.payments} pagos registrados: revise que no necesite conservarlos por obligaciones tributarias.</li>}
        </ul>
      </Card>
      {blocked ? <p className="rounded-lg bg-amber-50 p-4 text-sm text-amber-900" data-testid="eliminar-bloqueado">{blocked}</p> : (
        <Card title="Confirmar eliminación">
          <ActionForm action={deleteOrganization} submitLabel="🗑 Eliminar definitivamente" submitClass="btn-danger" resetOnSuccess={false} id="eliminar-org">
            <input type="hidden" name="org" value={o.id} />
            <Field label={`Escriba el enlace «${o.slug}» para confirmar`} name="confirm" required autoComplete="off" />
            <label className="flex items-start gap-2 text-sm"><input type="checkbox" name="borrar_cuentas" className="mt-1" />
              <span>Borrar también las cuentas de las personas que no pertenecen a ninguna otra organización (si alguna no se puede borrar, queda desactivada).</span></label>
            <label className="flex items-start gap-2 text-sm"><input type="checkbox" name="entiendo" required className="mt-1" />
              <span><b>Entiendo que no se puede deshacer.</b></span></label>
          </ActionForm>
        </Card>
      )}
      <p className="mt-4 text-sm"><Link className="link" href="/app/instituciones">← Volver sin eliminar</Link></p>
    </>
  );
}
