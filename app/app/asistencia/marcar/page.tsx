import { getContext } from '@/lib/context';
import { PageHeader, Card } from '@/components/ui';
import { ActionForm, Field } from '@/components/forms';
import { checkin } from '../actions';

export const dynamic = 'force-dynamic';

/** Página que abre el QR de la clase: el estudiante confirma con un toque. */
export default async function MarcarPage({ searchParams }: { searchParams: Promise<{ c?: string }> }) {
  const { c } = await searchParams;
  const ctx = await getContext();
  const code = String(c ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
  return (
    <div className="mx-auto max-w-md">
      <PageHeader title="✅ Marcar asistencia" subtitle={ctx.studentId ? 'Confirme que está en la clase.' : 'Solo los estudiantes inscritos pueden marcar asistencia.'} />
      <Card>
        <ActionForm action={checkin} submitLabel="✅ Marcar mi asistencia" submitClass="btn-primary w-full py-3 text-base">
          <Field label="Código de la clase" name="code" required defaultValue={code} placeholder="Ej.: K7P2QX" autoComplete="off" />
        </ActionForm>
      </Card>
    </div>
  );
}
