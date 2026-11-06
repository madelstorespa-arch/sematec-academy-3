import { getPublicSite } from '@/lib/site';

export const metadata = { title: 'Términos y privacidad' };

export default async function Page() {
  const site = await getPublicSite();
  return (
    <main className="mx-auto max-w-4xl space-y-12 px-4 py-12">
      <section id="terminos"><h1 className="text-3xl font-bold">Términos y condiciones</h1>
        <div className="mt-4 whitespace-pre-line text-slate-700">{site?.terms_text || 'La institución aún no publica sus términos y condiciones.'}</div></section>
      <section id="privacidad"><h2 className="text-2xl font-bold">Política de privacidad</h2>
        <div className="mt-4 whitespace-pre-line text-slate-700">{site?.privacy_text || 'La institución aún no publica su política de privacidad.'}</div></section>
    </main>
  );
}
