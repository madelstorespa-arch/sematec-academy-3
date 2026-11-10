import { getContext, can, requireOrg } from '@/lib/context';
import { PageHeader, Card, Badge, Empty } from '@/components/ui';
import { ActionForm, Field, Grid, SelectField, TextArea } from '@/components/forms';
import { fmtDate } from '@/lib/format';
import { setVisibility, addItem, loanItem, returnLoan } from './actions';
import { OwnerActions } from '@/components/owner-actions';
import { VisibilityFields } from './visibility';

export const metadata = { title: 'Biblioteca' };
const TYPES = [['libro', 'Libro'], ['ebook', 'Libro digital'], ['revista', 'Revista'], ['tesis', 'Tesis'], ['video', 'Video'], ['enlace', 'Enlace / recurso web'], ['otro', 'Otro']];

function Book({ b }: { b: any }) {
  const href = b.file_id ? `/app/biblioteca/libro/${b.file_id}` : b.url;
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className="flex gap-3 rounded-xl border border-slate-200 p-3 transition hover:border-brand-400 hover:shadow-sm">
      <span className="flex h-16 w-12 shrink-0 items-center justify-center rounded bg-gradient-to-b from-brand-600 to-brand-800 text-xl text-white">📘</span>
      <span className="min-w-0 text-sm">
        <b className="line-clamp-2">{b.title}</b>
        <span className="block text-xs text-slate-500">{b.author ?? ''}{b.year ? ` · ${b.year}` : ''}</span>
        <span className="mt-1 inline-block text-xs font-semibold text-brand-700">{b.file_id ? 'Leer ↗' : 'Abrir enlace ↗'}</span>
      </span>
    </a>
  );
}

export default async function Page({ searchParams }: { searchParams: Promise<{ q?: string; virtual?: string; carrera?: string; asignatura?: string; seccion?: string }> }) {
  const ctx = await getContext();
  const orgId = requireOrg(ctx);
  const { q, virtual, carrera, asignatura, seccion } = await searchParams;
  const uuid = (x?: string) => (x && /^[0-9a-f-]{36}$/i.test(x) ? x : null);
  const staff = can(ctx, 'library.edit');
  const clean = (q ?? '').replace(/[%,()]/g, '');
  let items = ctx.supabase.from('library_items').select('*, courses(name), programs(name), sections(code, courses(name))').eq('organization_id', orgId).order('title').limit(300);
  if (clean) items = items.or(`title.ilike.%${clean}%,author.ilike.%${clean}%,isbn.ilike.%${clean}%,category.ilike.%${clean}%`);
  if (virtual) items = items.or('file_id.not.is.null,url.not.is.null');
  if (uuid(carrera)) items = items.eq('program_id', uuid(carrera)!);
  if (uuid(asignatura)) items = items.eq('course_id', uuid(asignatura)!);
  if (uuid(seccion)) items = items.eq('section_id', uuid(seccion)!);
  const [{ data: list }, { data: loans }, { data: courses }, { data: borrowers }, { data: mine }, { data: programs }, { data: sections }] = await Promise.all([
    items,
    ctx.supabase.from('library_loans').select('*, library_items(title), profiles:borrower_id(full_name)')
      .eq('organization_id', orgId).match(staff ? {} : { borrower_id: ctx.user.id }).is('returned_at', null).order('due_on'),
    ctx.supabase.from('courses').select('id, code, name').eq('organization_id', orgId).order('name'),
    staff ? ctx.supabase.rpc('library_borrowers', { p_org: orgId }) : Promise.resolve({ data: [] as any[] }),
    ctx.studentId || ctx.teacherId ? ctx.supabase.rpc('my_virtual_books', { p_org: orgId }) : Promise.resolve({ data: [] as any[] }),
    ctx.supabase.from('programs').select('id, code, name').eq('organization_id', orgId).eq('status', 'active').order('name'),
    ctx.supabase.from('sections').select('id, code, courses(name), academic_periods(code)').eq('organization_id', orgId).eq('status', 'active').order('code').limit(300),
  ]);
  const today = new Date().toISOString().slice(0, 10);
  const due = new Date(Date.now() + 14 * 864e5).toISOString().slice(0, 10);
  return (
    <>
      <PageHeader title="Biblioteca" subtitle="Biblioteca virtual por carrera, asignatura y curso; libros físicos y préstamos" />
      {(ctx.studentId || ctx.teacherId) && (
        <Card title="📚 Mis libros virtuales" className="mb-6">
          {mine?.length
            ? <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{mine.map((b: any) => <Book key={b.id} b={b} />)}</div>
            : <Empty>Aún no hay libros virtuales para su carrera, asignaturas o cursos.</Empty>}
        </Card>
      )}
      {staff && (
        <div className="mb-6 grid gap-6 lg:grid-cols-2">
          <details className="card">
            <summary className="cursor-pointer px-5 py-3 text-sm font-bold text-brand-700">+ Agregar libro (virtual o físico)</summary>
            <div className="border-t border-slate-100 p-5">
              <ActionForm action={addItem} submitLabel="Agregar">
                <Field label="Título" name="title" required />
                <Grid>
                  <SelectField label="Tipo" name="item_type" defaultValue="libro" options={TYPES.map(([value, label]) => ({ value, label }))} />
                  <Field label="Autor" name="author" />
                  <Field label="Editorial" name="publisher" /><Field label="Año" name="year" type="number" />
                  <Field label="ISBN" name="isbn" /><Field label="Categoría" name="category" />
                  <Field label="Ejemplares físicos (0 si es solo virtual)" name="copies" type="number" min={0} defaultValue="0" />
                </Grid>
                <p className="text-xs font-semibold text-slate-600">¿Para quién es? * Elija al menos una carrera, asignatura o curso (los inscritos lo verán en «Mis libros virtuales»)</p>
                <Grid cols={3}>
                  <SelectField label="Carrera" name="program_id" placeholder="—" options={(programs ?? []).map((c: any) => ({ value: c.id, label: c.name }))} />
                  <SelectField label="Asignatura" name="course_id" placeholder="—" options={(courses ?? []).map((c: any) => ({ value: c.id, label: `${c.code} · ${c.name}` }))} />
                  <SelectField label="Curso / sección" name="section_id" placeholder="—" options={(sections ?? []).map((c: any) => ({ value: c.id, label: `${c.code} · ${c.courses?.name ?? ''} ${c.academic_periods?.code ?? ''}` }))} />
                </Grid>
                <label className="block"><span className="label">Archivo del libro (PDF, Word, PowerPoint; máx. 4 MB)</span>
                  <input type="file" name="file" accept=".pdf,.doc,.docx,.ppt,.pptx,.txt,.zip" className="text-sm" /></label>
                <Field label="…o enlace al libro (https://, por ejemplo Google Drive)" name="url" />
                <TextArea label="Descripción" name="description" />
                <VisibilityFields people={(borrowers ?? []) as any[]} />
              </ActionForm>
            </div>
          </details>
          <details className="card">
            <summary className="cursor-pointer px-5 py-3 text-sm font-bold text-brand-700">+ Registrar préstamo</summary>
            <div className="border-t border-slate-100 p-5">
              <ActionForm action={loanItem} submitLabel="Prestar">
                <SelectField label="Material" name="item_id" required
                  options={(list ?? []).filter((i: any) => i.available_copies > 0).map((i: any) => ({ value: i.id, label: `${i.title} (${i.available_copies} disp.)` }))} />
                <SelectField label="Lector" name="borrower_id" required options={(borrowers ?? []).map((b: any) => ({ value: b.user_id, label: `${b.full_name} · ${b.email}` }))} />
                <Field label="Devolver a más tardar" name="due_on" type="date" required defaultValue={due} />
              </ActionForm>
            </div>
          </details>
        </div>
      )}
      <Card title={staff ? 'Préstamos vigentes' : 'Mis préstamos'} className="mb-6">
        {loans?.length ? <div className="overflow-x-auto"><table className="table">
          <thead><tr><th>Material</th>{staff && <th>Lector</th>}<th>Prestado</th><th>Devolver</th><th></th></tr></thead>
          <tbody>{loans.map((l: any) => (
            <tr key={l.id}>
              <td>{l.library_items?.title}</td>{staff && <td>{l.profiles?.full_name}</td>}
              <td>{fmtDate(l.loaned_at)}</td>
              <td>{l.due_on < today ? <Badge color="red">Vencido {fmtDate(l.due_on)}</Badge> : fmtDate(l.due_on)}</td>
              <td>{staff && <ActionForm action={returnLoan} inline submitLabel="Devuelto" submitClass="btn-secondary btn-sm"><input type="hidden" name="id" value={l.id} /></ActionForm>}</td>
            </tr>))}</tbody>
        </table></div> : <Empty>No hay préstamos vigentes.</Empty>}
      </Card>
      <Card title="Catálogo">
        <form className="mb-4 flex flex-wrap gap-2">
          <input className="input max-w-sm" name="q" defaultValue={q} placeholder="Buscar por título, autor, ISBN o categoría" />
          <select name="carrera" defaultValue={carrera ?? ''} className="input max-w-[12rem]" aria-label="Carrera"><option value="">Todas las carreras</option>{(programs ?? []).map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
          <select name="asignatura" defaultValue={asignatura ?? ''} className="input max-w-[12rem]" aria-label="Asignatura"><option value="">Todas las asignaturas</option>{(courses ?? []).map((c: any) => <option key={c.id} value={c.id}>{c.code} · {c.name}</option>)}</select>
          <select name="seccion" defaultValue={seccion ?? ''} className="input max-w-[12rem]" aria-label="Sección"><option value="">Todos los cursos</option>{(sections ?? []).map((c: any) => <option key={c.id} value={c.id}>{c.code} · {c.courses?.name ?? ''}</option>)}</select>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="virtual" value="1" defaultChecked={!!virtual} /> Solo libros virtuales</label>
          <button className="btn-secondary">Buscar</button>
        </form>
        {list?.length ? <div className="overflow-x-auto"><table className="table">
          <thead><tr><th>Título</th><th>Autor</th><th>Tipo</th><th>Para</th><th>Disponibles</th><th></th></tr></thead>
          <tbody>{list.map((i: any) => (
            <tr key={i.id}>
              <td><b>{i.title}</b>{i.year ? ` (${i.year})` : ''}{staff && (i.visible_roles?.length > 0 || i.hidden_users?.length > 0) && <span className="ml-2" data-testid="restringido"><Badge color="amber">🔒 Restringido</Badge></span>}{i.description && <span className="block text-xs text-slate-500">{i.description}</span>}</td>
              <td>{i.author ?? '—'}</td><td>{TYPES.find(([v]) => v === i.item_type)?.[1]}</td><td className="text-xs">{[i.programs?.name && `Carrera: ${i.programs.name}`, i.courses?.name && `Asignatura: ${i.courses.name}`, i.sections?.code && `Curso: ${i.sections.code}`].filter(Boolean).join(' · ') || <span className="text-amber-700">⚠ Sin asociar (edítelo)</span>}</td>
              <td>{i.total_copies ? `${i.available_copies} de ${i.total_copies}` : '—'}</td>
              <td className="space-y-1 whitespace-nowrap">{i.file_id && <a className="link block" href={`/app/biblioteca/libro/${i.file_id}`} target="_blank" rel="noopener noreferrer">📘 Leer</a>}
                {i.url && <a className="link block" href={i.url} target="_blank" rel="noopener noreferrer">Abrir ↗</a>}
                {staff && <details className="text-left"><summary className="link cursor-pointer text-xs">👁 Quién lo ve</summary>
                  <div className="mt-2 w-[min(90vw,32rem)] whitespace-normal rounded-xl border border-slate-200 bg-white p-3 shadow-lg">
                    <ActionForm action={setVisibility} submitLabel="Guardar" resetOnSuccess={false}><input type="hidden" name="id" value={i.id} />
                      <VisibilityFields roles={i.visible_roles ?? []} hidden={i.hidden_users ?? []} people={(borrowers ?? []) as any[]} /></ActionForm></div></details>}
                {ctx.isOwner && <OwnerActions table="library_items" id={i.id} path="/app/biblioteca" name={`«${i.title}»`} />}</td>
            </tr>))}</tbody>
        </table></div> : <Empty>{q ? 'Sin resultados.' : 'El catálogo está vacío.'}</Empty>}
      </Card>
    </>
  );
}
