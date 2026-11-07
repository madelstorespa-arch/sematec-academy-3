import { ActionForm, PasswordInput } from '@/components/forms';
import { grantPortalAccess, resetPortalPassword } from '@/app/app/estudiantes/actions';

/** Crear la cuenta (o cambiar la contraseña) de un estudiante o profesor con una contraseña elegida por el administrador. */
export function AccessForm({ kind, id, email, hasAccount }: { kind: 'student' | 'teacher'; id: string; email?: string | null; hasAccount: boolean }) {
  return (
    <ActionForm action={hasAccount ? resetPortalPassword : grantPortalAccess} inline resetOnSuccess
      submitLabel={hasAccount ? '🔑 Cambiar' : '🔑 Crear cuenta'} submitClass={hasAccount ? 'btn-secondary btn-sm' : 'btn-primary btn-sm'}>
      <input type="hidden" name="kind" value={kind} /><input type="hidden" name="id" value={id} />
      {email && <input type="hidden" name="email" value={email} />}
      <span className="inline-block w-40"><PasswordInput name="password" required minLength={10} autoComplete="new-password" placeholder={hasAccount ? 'Nueva contraseña' : 'Contraseña'}
        className="input py-1 text-xs" title="Mínimo 10 caracteres, con mayúsculas, minúsculas y números" /></span>
    </ActionForm>
  );
}
