import Link from 'next/link';
import { AuthShell } from '@/components/brand';
import { ActionForm, Field } from '@/components/forms';
import { requestReset } from '../login/actions';

export const metadata = { title: 'Recuperar contraseña' };
export default function Page() {
  return (
    <AuthShell title="Recuperar contraseña" subtitle="Le enviaremos un enlace temporal a su correo.">
      <ActionForm action={requestReset} submitLabel="Enviar enlace" submitClass="btn-primary w-full">
        <Field label="Correo" name="email" type="email" required />
      </ActionForm>
      <p className="mt-6 text-center text-sm"><Link className="link" href="/login">Volver</Link></p>
    </AuthShell>
  );
}
