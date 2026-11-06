import { AuthShell } from '@/components/brand';
import { MfaClient } from './mfa-client';

export const metadata = { title: 'Verificación en dos pasos' };
export default function Page() {
  return (
    <AuthShell title="Verificación en dos pasos" subtitle="Su rol exige un segundo factor (MFA) con una app de autenticación: Google Authenticator, Microsoft Authenticator, Authy u otra.">
      <MfaClient />
    </AuthShell>
  );
}
