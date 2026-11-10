import Link from 'next/link';
import { AuthShell } from '@/components/brand';
import { ActionForm, Field } from '@/components/forms';
import { requestOrganization } from './actions';

export const metadata = { title: 'Solicitar una plataforma para su organización' };

/** 🌐 Formulario público: institutos, asociaciones u organizaciones piden su propia aula virtual. */
export default function RegistroOrganizacion() {
  return (
    <AuthShell title="Su propia aula virtual" subtitle="Para institutos, colegios, asociaciones, fundaciones, iglesias o empresas. Sus datos quedan separados de las demás organizaciones.">
      <ActionForm action={requestOrganization} submitLabel="Enviar solicitud" submitClass="btn-primary w-full" id="registro-org">
        <Field label="Nombre de la organización" name="org_name" required />
        <label className="block"><span className="label">Tipo</span>
          <select name="org_kind" className="input" defaultValue="organizacion">
            <option value="instituto">Instituto</option><option value="colegio">Colegio</option><option value="universidad">Universidad</option>
            <option value="asociacion">Asociación</option><option value="organizacion">Organización</option><option value="fundacion">Fundación</option>
            <option value="iglesia">Iglesia</option><option value="empresa">Empresa</option><option value="otro">Otro</option>
          </select></label>
        <label className="block"><span className="label">¿Qué necesita?</span>
          <select name="wants" className="input" defaultValue="aula">
            <option value="aula">Aula virtual (clases en vivo, grabaciones, archivos)</option>
            <option value="completo">Plataforma completa (académico y administración)</option>
            <option value="independiente">Plataforma independiente con su propia base de datos</option>
          </select></label>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Su nombre" name="contact_name" required autoComplete="name" />
          <Field label="Correo" name="contact_email" type="email" required autoComplete="email" />
          <Field label="Teléfono / WhatsApp" name="phone" autoComplete="tel" />
          <Field label="Personas aprox." name="members_estimate" type="number" min={1} />
        </div>
        <label className="block"><span className="label">País</span>
          <select name="country" className="input" defaultValue="CL">
            {[['CL', 'Chile'], ['AR', 'Argentina'], ['PE', 'Perú'], ['BO', 'Bolivia'], ['CO', 'Colombia'], ['MX', 'México'], ['UY', 'Uruguay'], ['PY', 'Paraguay'], ['US', 'Estados Unidos'], ['ES', 'España']].map(([c, n]) => <option key={c} value={c}>{n}</option>)}
          </select></label>
        <label className="block"><span className="label">Mensaje (opcional)</span>
          <textarea name="message" maxLength={2000} rows={3} className="input" /></label>
        <input type="text" name="website" tabIndex={-1} autoComplete="off" aria-hidden className="hidden" />
      </ActionForm>
      <p className="mt-6 text-center text-sm"><Link className="link" href="/login">¿Ya tiene cuenta? Ingresar</Link></p>
    </AuthShell>
  );
}
