import Link from 'next/link';
import { AuthShell } from '@/components/brand';
import { ActionForm, Field } from '@/components/forms';
import { changePassword } from '../login/actions';

export const metadata = { title: 'Nueva contraseña' };
export default function Page() {
  return (
    <AuthShell title="Nueva contraseña" subtitle="Mínimo 12 caracteres, con mayúsculas, minúsculas y números.">
      <ActionForm action={changePassword} submitLabel="Guardar contraseña" submitClass="btn-primary w-full">
        <Field label="Nueva contraseña" name="password" type="password" required autoComplete="new-password" />
        <Field label="Repetir contraseña" name="confirm" type="password" required autoComplete="new-password" />
      </ActionForm>
      <p className="mt-6 text-center text-sm"><Link className="link" href="/app">Ir a la plataforma</Link></p>
    </AuthShell>
  );
}
