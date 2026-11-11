import Link from 'next/link';
import { getAppBrand } from '@/lib/app-brand';
import { getPublicSite } from '@/lib/site';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Política de privacidad de la app' };

/** 🔒 Política de privacidad de la app de Android (la exige Google Play). Página pública y fija. */
export default async function PrivacidadApp() {
  const [brand, site] = await Promise.all([getAppBrand(), getPublicSite()]);
  const name = brand.name;
  const email = site?.contact_email ?? null;
  return (
    <main className="mx-auto max-w-3xl space-y-6 px-4 py-10 text-slate-700" data-testid="privacidad-app">
      <h1 className="text-3xl font-bold text-slate-900">Política de privacidad — App {name}</h1>
      <p className="text-sm text-slate-500">Vigente desde el 11 de noviembre de 2026.</p>

      <section className="space-y-2">
        <h2 className="text-xl font-bold text-slate-900">1. Qué es la app</h2>
        <p>La app «{name} Aula» abre la plataforma educativa {name} (clases en vivo, archivos, mensajes y demás módulos) y permite compartir la pantalla del celular durante una clase. Usa la misma cuenta y los mismos datos que la plataforma web.</p>
      </section>

      <section className="space-y-2">
        <h2 className="text-xl font-bold text-slate-900">2. Datos que se usan</h2>
        <ul className="list-disc space-y-1 pl-5">
          <li><b>Cuenta:</b> nombre, correo y datos que la institución registra para dar el servicio (por ejemplo, cursos y notas).</li>
          <li><b>Cámara y micrófono:</b> solo cuando usted los activa en una clase en vivo, para transmitir su imagen y voz a los participantes.</li>
          <li><b>Pantalla:</b> solo cuando usted toca «Compartir mi pantalla» y acepta el aviso de Android; se transmite a la clase y se detiene cuando usted lo indica.</li>
          <li><b>Archivos:</b> solo los que usted elige subir.</li>
          <li><b>Datos técnicos:</b> registros de seguridad (inicio de sesión, dirección IP) para proteger las cuentas.</li>
        </ul>
        <p>La app no accede a sus contactos, ubicación, fotos ni archivos sin que usted los elija, y no muestra publicidad.</p>
      </section>

      <section className="space-y-2">
        <h2 className="text-xl font-bold text-slate-900">3. Para qué se usan</h2>
        <p>Únicamente para dar el servicio educativo: identificarle, mostrar sus cursos, realizar clases en vivo, guardar sus archivos y mantener la seguridad. <b>No vendemos ni compartimos sus datos con fines publicitarios.</b></p>
      </section>

      <section className="space-y-2">
        <h2 className="text-xl font-bold text-slate-900">4. Dónde se guardan y con quién se comparten</h2>
        <p>Los datos viajan cifrados (HTTPS) y se guardan con proveedores de infraestructura que actúan por cuenta de la institución: Supabase (base de datos y archivos), Vercel (servidor web) y LiveKit (audio y video de las clases). Las grabaciones de clases solo existen si el anfitrión las inicia, y se avisa a los participantes.</p>
      </section>

      <section className="space-y-2">
        <h2 className="text-xl font-bold text-slate-900">5. Sus derechos y eliminación de datos</h2>
        <p>Puede pedir acceso, corrección o eliminación de su cuenta y sus datos a la institución{email ? <> escribiendo a <a className="link" href={`mailto:${email}`}>{email}</a></> : <> desde la página de <Link className="link" href="/contacto">contacto</Link></>}. Los registros que la ley obliga a conservar (por ejemplo, comprobantes de pago) se mantienen el tiempo exigido.</p>
      </section>

      <section className="space-y-2">
        <h2 className="text-xl font-bold text-slate-900">6. Menores de edad</h2>
        <p>La plataforma puede usarse por estudiantes menores de edad dentro de su institución educativa. Sus cuentas las crea la institución, que es responsable de contar con la autorización de sus padres o apoderados.</p>
      </section>

      <section className="space-y-2">
        <h2 className="text-xl font-bold text-slate-900">7. Cambios</h2>
        <p>Si esta política cambia, se publicará en esta misma página con su nueva fecha.</p>
      </section>
    </main>
  );
}
