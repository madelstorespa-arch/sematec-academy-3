import Link from 'next/link';
import { AuthShell } from '@/components/brand';
import { ActionForm, Field, TextArea } from '@/components/forms';
import { requestHelp, requestReset } from '../login/actions';

export const metadata = { title: 'Recuperar contraseña' };

/** 🔑 Recuperar contraseña: para todos (estudiantes, apoderados, profesores, personal), con correo o RUT. */
export default function Page() {
  return (
    <AuthShell title="Recuperar contraseña" subtitle="Para todos los usuarios: estudiantes, apoderados, profesores y personal.">
      <div data-testid="recuperar-correo">
        <p className="mb-3 text-sm text-slate-600">Escriba su correo o su RUT. Le enviaremos al correo registrado un enlace para crear una contraseña nueva.</p>
        <ActionForm action={requestReset} submitLabel="Enviar enlace" submitClass="btn-primary w-full">
          <Field label="Correo o RUT" name="email" required autoComplete="username" placeholder="nombre@correo.cl o 12.345.678-5" />
        </ActionForm>
      </div>
      <details className="mt-6 rounded-xl border border-slate-200 p-4" data-testid="sin-correo">
        <summary className="cursor-pointer text-sm font-semibold text-brand-700">¿No tiene correo, no le llega o perdió el celular de verificación?</summary>
        <p className="mt-2 text-sm text-slate-600">Deje sus datos y la administración de su institución le dará una contraseña temporal. Le pedirán confirmar su identidad.</p>
        <div className="mt-3">
          <ActionForm action={requestHelp} submitLabel="Pedir ayuda a la administración" submitClass="btn-secondary w-full">
            <Field label="Su RUT o el correo con que entra" name="identifier" required placeholder="12.345.678-5" />
            <Field label="Nombre completo" name="full_name" required autoComplete="name" />
            <Field label="Teléfono o correo para contactarle" name="contact" required placeholder="+56 9 1234 5678" autoComplete="tel" />
            <label className="block"><span className="label">¿Qué pasó?</span>
              <select name="reason" className="input" defaultValue="sin_correo">
                <option value="sin_correo">No tengo correo o ya no lo uso</option>
                <option value="no_llega">El correo no me llega</option>
                <option value="mfa">Perdí el celular de la verificación en dos pasos</option>
                <option value="otro">Otro</option>
              </select></label>
            <TextArea label="Mensaje (opcional)" name="message" rows={2} />
          </ActionForm>
        </div>
      </details>
      <p className="mt-6 text-center text-sm"><Link className="link" href="/login">Volver a entrar</Link></p>
    </AuthShell>
  );
}
