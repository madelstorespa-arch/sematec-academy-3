import Link from 'next/link';
import { AuthShell } from '@/components/brand';
import { ActionForm, Field } from '@/components/forms';
import { signIn } from './actions';

export const metadata = { title: 'Iniciar sesión' };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string; error?: string }> }) {
  const { next, error } = await searchParams;
  return (
    <AuthShell title="Iniciar sesión" subtitle="Acceda con su cuenta institucional.">
      {error === 'enlace' && <p className="mb-4 rounded-lg bg-amber-50 p-3 text-sm text-amber-900">El enlace del correo ya se usó o venció. <Link className="link" href="/recuperar">Pida uno nuevo</Link>.</p>}
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
