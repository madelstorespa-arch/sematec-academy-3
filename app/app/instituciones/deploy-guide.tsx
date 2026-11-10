'use client';
import { useState } from 'react';

const ENV = [
  ['NEXT_PUBLIC_SUPABASE_URL', 'Supabase → Project Settings → API → Project URL'],
  ['NEXT_PUBLIC_SUPABASE_ANON_KEY', 'Supabase → API → anon public'],
  ['SUPABASE_SERVICE_ROLE_KEY', 'Supabase → API → service_role (secreta)'],
  ['DATABASE_URL', 'Supabase → Connect → Session pooler (con la contraseña de la base)'],
  ['SETUP_TOKEN', 'Una clave larga inventada por usted (solo para instalar; luego se borra)'],
  ['NEXT_PUBLIC_LIVEKIT_URL', 'LiveKit Cloud → Settings → URL del proyecto (wss://…)'],
  ['LIVEKIT_API_KEY', 'LiveKit → Settings → Keys'],
  ['LIVEKIT_API_SECRET', 'LiveKit → Settings → Keys (secreta)'],
];

/** 🏗 Guía para crear una plataforma independiente: otro proyecto de Vercel + otra base de datos de Supabase. */
export function DeployGuide({ repo }: { repo: string }) {
  const [name, setName] = useState('');
  const slug = name.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
  const url = `https://vercel.com/new/clone?${new URLSearchParams({
    'repository-url': `https://github.com/${repo}`, 'project-name': slug || 'aula-organizacion', env: ENV.map(([k]) => k).join(','),
    envDescription: 'Claves del Supabase y LiveKit propios de la organización (nunca las comparta por chat)',
  }).toString()}`;
  return (
    <div className="space-y-4 text-sm" data-testid="guia-independiente">
      <p className="text-slate-600">Una plataforma independiente es una <b>copia completa del sistema</b> con <b>su propia base de datos</b> y su propia dirección web. Comparte el mismo código: cada mejora que usted publique llega también a ella.</p>
      <label className="block max-w-sm"><span className="label">Nombre de la organización</span>
        <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Instituto Nueva Esperanza" data-testid="indep-nombre" /></label>
      <ol className="list-decimal space-y-3 pl-5">
        <li><b>Base de datos propia:</b> en <a className="link" href="https://supabase.com/dashboard/new" target="_blank" rel="noreferrer">supabase.com</a> cree un proyecto nuevo (región São Paulo). Guarde la contraseña de la base en un lugar seguro.</li>
        <li><b>Video propio (opcional):</b> en <a className="link" href="https://cloud.livekit.io" target="_blank" rel="noreferrer">cloud.livekit.io</a> cree un proyecto, o use el mismo LiveKit de SEMATEC.</li>
        <li><b>Sitio propio:</b> pulse el botón; Vercel copia el sistema y le pide las claves. Escríbalas <b>solo en Vercel</b>, nunca en el chat ni en GitHub.
          <a className="btn-primary mt-2 block w-fit" href={url} target="_blank" rel="noreferrer" data-testid="indep-desplegar">▲ Crear {slug ? `«${slug}»` : 'la plataforma'} en Vercel</a></li>
        <li><b>Instalar:</b> abra <code>https://{slug || 'su-proyecto'}.vercel.app/instalar</code>, escriba el SETUP_TOKEN, marque <b>«Solo aula virtual»</b> si es solo para clases, y cree la cuenta del administrador de la organización.</li>
        <li><b>Seguridad:</b> borre SETUP_TOKEN en Vercel (Settings → Environment Variables) y pulse Redeploy. Agregue SMTP_USER y SMTP_PASS (contraseña de aplicación de Gmail) para que envíe correos.</li>
        <li><b>Directorio:</b> escriba su dirección abajo para tenerla a mano desde aquí.</li>
      </ol>
      <details className="rounded-lg border border-slate-200 p-3"><summary className="cursor-pointer font-semibold">Claves que pide Vercel</summary>
        <table className="table mt-2"><tbody>{ENV.map(([k, d]) => <tr key={k}><td><code className="text-xs">{k}</code></td><td className="text-xs text-slate-600">{d}</td></tr>)}</tbody></table>
      </details>
      <p className="text-xs text-slate-500">Actualizaciones: cuando publique una mejora, Vercel la instala en todas las plataformas. En cada una, su administrador pulsa <b>⬆ Actualizar sistema → Aplicar</b> para actualizar su base de datos.</p>
    </div>
  );
}
