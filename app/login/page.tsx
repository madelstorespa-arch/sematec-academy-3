import Link from 'next/link';
import { AuthShell } from '@/components/brand';
import { ActionForm, Field } from '@/components/forms';
import { signIn } from './actions';

export const metadata = { title: 'Iniciar sesión' };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  return (
    <AuthShell title="Iniciar sesión" subtitle="Acceda con su cuenta institucional.">
      <ActionForm action={signIn} submitLabel="Ingresar" submitClass="btn-primary w-full" resetOnSuccess={false}>
        <input type="hidden" name="next" value={next ?? '/app'} />
        <Field label="Correo" name="email" type="email" required autoComplete="email" />
        <Field label="Contraseña" name="password" type="password" required autoComplete="current-password" />
      </ActionForm>
      <p className="mt-6 text-center text-sm"><Link className="link" href="/recuperar">¿Olvidó su contraseña?</Link></p>
      <p className="mt-2 text-center text-sm"><Link className="link" href="/verificar">Verificar un certificado</Link></p>
    </AuthShell>
  );
}
