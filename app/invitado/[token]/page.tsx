import { createAdminClient } from '@/lib/supabase/admin';
import { fmtDateTime } from '@/lib/format';
import { GuestJoin } from './guest';

export const metadata = { title: 'Ingreso de invitados', robots: { index: false, follow: false } };
export const dynamic = 'force-dynamic';

const REASONS: Record<string, string> = {
  not_found: 'Este enlace no existe. Pida uno nuevo a quien lo invitó.', revoked: 'El anfitrión desactivó este enlace.',
  expired: 'Este enlace venció. Pida uno nuevo a quien lo invitó.', ended: 'La clase o reunión ya terminó.',
  full: 'Este enlace alcanzó el máximo de personas.', too_early: 'La sala abre 15 minutos antes del inicio.',
};

/** Página pública para invitados externos: se identifican y entran a la clase o reunión. */
export default async function Page({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const ok = /^[A-Za-z0-9_-]{16,64}$/.test(token);
  const { data: info } = ok ? await createAdminClient().rpc('guest_invite_info', { p_token: token }) : { data: null };
  return (
    <main className="min-h-screen bg-gradient-to-br from-[#0b1430] via-[#13224d] to-[#1d4ed8] px-4 py-10">
      <div className="mx-auto max-w-lg">
        <p className="mb-4 text-center text-sm font-semibold uppercase tracking-widest text-sky-200">{info?.org ?? 'Aula virtual'}</p>
        <div className="rounded-2xl bg-white p-6 shadow-2xl sm:p-8">
          {!info?.title ? <p className="text-center text-slate-700">{REASONS.not_found}</p> : (<>
            <h1 className="text-2xl font-bold text-ink">{info.title}</h1>
            <p className="mt-1 text-sm text-slate-500">🗓 {fmtDateTime(info.starts, info.tz)} – {fmtDateTime(info.ends, info.tz).split(' ').pop()}</p>
            {info.valid ? <GuestJoin token={token} requireDocument={!!info.require_document} title={info.title} />
              : <p className="mt-6 rounded-lg bg-amber-50 p-3 text-sm text-amber-800">{REASONS[info.reason] ?? 'No se puede entrar con este enlace.'}</p>}
          </>)}
        </div>
        <p className="mt-4 text-center text-xs text-sky-100/70">Sus datos se usan solo para el registro de asistencia de esta sesión.</p>
      </div>
    </main>
  );
}
