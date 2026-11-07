import Link from 'next/link';
import { getContext, can, requireOrg } from '@/lib/context';
import { PageHeader, Card, Badge, Empty, Stat } from '@/components/ui';
import { ActionForm, Field, Grid, SelectField } from '@/components/forms';
import { fullName } from '@/lib/format';
import { saveAlumniProfile } from './actions';

export const metadata = { title: 'Egresados' };
const EMP: Record<string, string> = { empleado: 'Trabajando (dependiente)', independiente: 'Trabajando (independiente)', estudiando: 'Continúa estudios', buscando: 'Buscando trabajo', sin_info: 'Sin información' };
const empOpts = Object.entries(EMP).map(([value, label]) => ({ value, label }));

export default async function Page({ searchParams }: { searchParams: Promise<{ anio?: string; q?: string }> }) {
  const ctx = await getContext();
  const orgId = requireOrg(ctx);
  const sp = await searchParams;
  const sb = ctx.supabase;
  const staff = can(ctx, 'alumni.view');
  const [{ data: mine }, list] = await Promise.all([
    ctx.studentId ? sb.from('alumni_profiles').select('*').eq('student_id', ctx.studentId).maybeSingle() : Promise.resolve({ data: null as any }),
    staff
      ? sb.from('students').select('id, first_names, last_names, student_code, email, phone, alumni_profiles(*)').eq('organization_id', orgId).eq('status', 'graduated').order('last_names').limit(1000)
      : Promise.resolve({ data: [] as any[] }),
  ]);
  const ap = (s: any) => (Array.isArray(s.alumni_profiles) ? s.alumni_profiles[0] : s.alumni_profiles) ?? null;
  let alumni = (list.data ?? []) as any[];
  if (sp.anio) alumni = alumni.filter((s) => String(ap(s)?.graduation_year ?? '') === sp.anio);
  if (sp.q) { const q = sp.q.toLowerCase(); alumni = alumni.filter((s) => `${s.first_names} ${s.last_names} ${ap(s)?.employer ?? ''} ${ap(s)?.program_name ?? ''}`.toLowerCase().includes(q)); }
  const all = (list.data ?? []) as any[];
  const withInfo = all.filter((s) => ap(s) && ap(s).employment !== 'sin_info');
  const working = withInfo.filter((s) => ['empleado', 'independiente'].includes(ap(s).employment));
  const years = Array.from(new Set(all.map((s) => ap(s)?.graduation_year).filter(Boolean))).sort().reverse();

  return (
    <>
      <PageHeader title="Egresados" subtitle="Seguimiento de egresados y red de contactos" actions={<Link className="btn-secondary" href="/app/empleos">💼 Bolsa de empleo</Link>} />

      {ctx.studentId && (
        <Card title="Mi perfil de egresado" className="mb-6">
          <p className="mb-3 text-sm text-slate-600">Cuéntenos qué está haciendo: nos ayuda a mejorar los programas y a enviarle ofertas de empleo.</p>
          <ActionForm action={saveAlumniProfile} submitLabel="Guardar" resetOnSuccess={false}>
            <Grid cols={3}>
              <Field label="Año de egreso" name="graduation_year" type="number" min={1950} max={2100} defaultValue={mine?.graduation_year} />
              <SelectField label="Situación actual" name="employment" required defaultValue={mine?.employment ?? 'sin_info'} options={empOpts} />
              <Field label="Empresa o institución" name="employer" defaultValue={mine?.employer} />
              <Field label="Cargo" name="job_title" defaultValue={mine?.job_title} />
              <Field label="LinkedIn (https://…)" name="linkedin_url" type="url" defaultValue={mine?.linkedin_url} />
            </Grid>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="consent_contact" defaultChecked={mine?.consent_contact} /> Acepto que la institución me contacte con ofertas laborales y actividades</label>
          </ActionForm>
        </Card>
      )}

      {staff && (
        <>
          <div className="mb-6 grid gap-3 sm:grid-cols-4">
            <Stat label="Egresados" value={all.length} />
            <Stat label="Con información" value={withInfo.length} />
            <Stat label="Trabajando" value={working.length} hint={withInfo.length ? `${Math.round((100 * working.length) / withInfo.length)}% de quienes informan` : undefined} />
            <Stat label="Aceptan contacto" value={all.filter((s) => ap(s)?.consent_contact).length} />
          </div>
          <Card title="Listado de egresados">
            <form className="mb-4 flex flex-wrap gap-2">
              <input className="input max-w-xs" name="q" placeholder="Buscar nombre, empresa o programa" defaultValue={sp.q} />
              <select className="input max-w-[10rem]" name="anio" defaultValue={sp.anio ?? ''}>
                <option value="">Todos los años</option>{years.map((y) => <option key={y} value={y}>{y}</option>)}
              </select>
              <button className="btn-secondary">Filtrar</button>
            </form>
            {alumni.length ? (
              <div className="overflow-x-auto"><table className="table">
                <thead><tr><th>Nombre</th><th>Programa</th><th>Año</th><th>Situación</th><th>Empresa · cargo</th><th>Contacto</th></tr></thead>
                <tbody>{alumni.map((s) => { const a = ap(s); return (
                  <tr key={s.id}>
                    <td><Link className="link" href={`/app/estudiantes/${s.id}`}>{fullName(s)}</Link></td>
                    <td>{a?.program_name ?? '—'}</td><td>{a?.graduation_year ?? '—'}</td>
                    <td><Badge color={['empleado', 'independiente'].includes(a?.employment) ? 'green' : a?.employment === 'buscando' ? 'amber' : 'gray'}>{EMP[a?.employment ?? 'sin_info']}</Badge></td>
                    <td>{[a?.employer, a?.job_title].filter(Boolean).join(' · ') || '—'}{a?.linkedin_url && <> · <a className="link" href={a.linkedin_url} target="_blank" rel="noopener noreferrer">LinkedIn</a></>}</td>
                    <td className="text-xs">{a?.consent_contact ? <>{s.email}<br />{s.phone}</> : <span className="text-slate-400">No autoriza</span>}</td>
                  </tr>); })}
                </tbody>
              </table></div>
            ) : <Empty>No hay egresados {sp.q || sp.anio ? 'con ese filtro' : 'todavía. Un estudiante pasa a egresado al cambiar su estado a «Egresado» en su ficha'}.</Empty>}
          </Card>
        </>
      )}
    </>
  );
}
