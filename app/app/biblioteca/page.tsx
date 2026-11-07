import { getContext, can, requireOrg } from '@/lib/context';
import { PageHeader, Card, Badge, Empty } from '@/components/ui';
import { ActionForm, Field, Grid, SelectField, TextArea } from '@/components/forms';
import { fmtDate } from '@/lib/format';
import { addItem, loanItem, returnLoan } from './actions';

export const metadata = { title: 'Biblioteca' };
const TYPES = [['libro', 'Libro'], ['ebook', 'Libro digital'], ['revista', 'Revista'], ['tesis', 'Tesis'], ['video', 'Video'], ['enlace', 'Enlace / recurso web'], ['otro', 'Otro']];

export default async function Page({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const ctx = await getContext();
  const orgId = requireOrg(ctx);
  const { q } = await searchParams;
  const staff = can(ctx, 'library.edit');
  const clean = (q ?? '').replace(/[%,()]/g, '');
  let items = ctx.supabase.from('library_items').select('*, courses(name)').eq('organization_id', orgId).order('title').limit(300);
  if (clean) items = items.or(`title.ilike.%${clean}%,author.ilike.%${clean}%,isbn.ilike.%${clean}%,category.ilike.%${clean}%`);
  const [{ data: list }, { data: loans }, { data: courses }, { data: borrowers }] = await Promise.all([
    items,
    ctx.supabase.from('library_loans').select('*, library_items(title), profiles:borrower_id(full_name)')
      .eq('organization_id', orgId).match(staff ? {} : { borrower_id: ctx.user.id }).is('returned_at', null).order('due_on'),
    staff ? ctx.supabase.from('courses').select('id, code, name').eq('organization_id', orgId).order('name') : Promise.resolve({ data: [] as any[] }),
    staff ? ctx.supabase.rpc('library_borrowers', { p_org: orgId }) : Promise.resolve({ data: [] as any[] }),
  ]);
  const today = new Date().toISOString().slice(0, 10);
  const due = new Date(Date.now() + 14 * 864e5).toISOString().slice(0, 10);
  return (
    <>
      <PageHeader title="Biblioteca" subtitle="Catálogo de libros y recursos, préstamos y devoluciones" />
      {staff && (
        <div className="mb-6 grid gap-6 lg:grid-cols-2">
          <details className="card">
            <summary className="cursor-pointer px-5 py-3 text-sm font-bold text-brand-700">+ Agregar material</summary>
            <div className="border-t border-slate-100 p-5">
              <ActionForm action={addItem} submitLabel="Agregar">
                <Field label="Título" name="title" required />
                <Grid>
                  <SelectField label="Tipo" name="item_type" defaultValue="libro" options={TYPES.map(([value, label]) => ({ value, label }))} />
                  <Field label="Autor" name="author" />
                  <Field label="Editorial" name="publisher" /><Field label="Año" name="year" type="number" />
                  <Field label="ISBN" name="isbn" /><Field label="Categoría" name="category" />
                  <SelectField label="Asignatura (opcional)" name="course_id" options={(courses ?? []).map((c: any) => ({ value: c.id, label: `${c.code} · ${c.name}` }))} />
                  <Field label="Ejemplares físicos" name="copies" type="number" min={0} defaultValue="1" />
                </Grid>
                <Field label="Enlace (libros digitales o recursos web, https://)" name="url" />
                <TextArea label="Descripción" name="description" />
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
        <form className="mb-4 flex gap-2">
          <input className="input max-w-sm" name="q" defaultValue={q} placeholder="Buscar por título, autor, ISBN o categoría" />
          <button className="btn-secondary">Buscar</button>
        </form>
        {list?.length ? <div className="overflow-x-auto"><table className="table">
          <thead><tr><th>Título</th><th>Autor</th><th>Tipo</th><th>Asignatura</th><th>Disponibles</th><th></th></tr></thead>
          <tbody>{list.map((i: any) => (
            <tr key={i.id}>
              <td><b>{i.title}</b>{i.year ? ` (${i.year})` : ''}{i.description && <span className="block text-xs text-slate-500">{i.description}</span>}</td>
              <td>{i.author ?? '—'}</td><td>{TYPES.find(([v]) => v === i.item_type)?.[1]}</td><td>{i.courses?.name ?? '—'}</td>
              <td>{i.total_copies ? `${i.available_copies} de ${i.total_copies}` : '—'}</td>
              <td>{i.url && <a className="link" href={i.url} target="_blank" rel="noopener noreferrer">Abrir ↗</a>}</td>
            </tr>))}</tbody>
        </table></div> : <Empty>{q ? 'Sin resultados.' : 'El catálogo está vacío.'}</Empty>}
      </Card>
    </>
  );
}
