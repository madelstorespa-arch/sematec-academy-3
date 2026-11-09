import Link from 'next/link';
import { redirect } from 'next/navigation';
import { AuthShell } from '@/components/brand';
import { ActionForm, Field } from '@/components/forms';
import { createClient } from '@/lib/supabase/server';
import { changePassword } from '../login/actions';

export const metadata = { title: 'Nueva contraseña' };
export const dynamic = 'force-dynamic';

export default async function Page() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return (
      <AuthShell title="Enlace vencido" subtitle="El enlace para crear la contraseña ya se usó o venció (dura 1 hora).">
        <Link href="/recuperar" className="btn-primary w-full">Pedir un enlace nuevo</Link>
        <p className="mt-6 text-center text-sm"><Link className="link" href="/login">Volver al inicio de sesión</Link></p>
      </AuthShell>
    );
  }
  // Si la cuenta tiene verificación en dos pasos, primero se pide el código (Supabase lo exige para cambiar la contraseña)
  const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (aal?.nextLevel === 'aal2' && aal.currentLevel !== 'aal2') redirect('/mfa?next=/cambiar-clave');
  return (
    <AuthShell title="Nueva contraseña" subtitle={`Cuenta: ${user.email}. Mínimo 12 caracteres, con mayúsculas, minúsculas y números.`}>
      <ActionForm action={changePassword} submitLabel="Guardar contraseña" submitClass="btn-primary w-full">
        <Field label="Nueva contraseña" name="password" type="password" required autoComplete="new-password" />
        <Field label="Repetir contraseña" name="confirm" type="password" required autoComplete="new-password" />
      </ActionForm>
      <p className="mt-6 text-center text-sm"><Link className="link" href="/app">Ir a la plataforma</Link></p>
    </AuthShell>
  );
}
