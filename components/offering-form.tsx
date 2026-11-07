import { Field, Grid, SelectField, TextArea } from '@/components/forms';
type Opt = { value: string; label: string };
export function OfferingFields({ d = {}, programs, periods, currency }: { d?: Record<string, any>; programs: Opt[]; periods: Opt[]; currency: string }) {
  return (
    <>
      <Grid cols={3}>
        <Field label="Título" name="title" required defaultValue={d.title} className="md:col-span-2" />
        <Field label="Dirección web" name="slug" required defaultValue={d.slug} placeholder="excel-avanzado" />
        <SelectField label="Tipo" name="kind" required defaultValue={d.kind ?? 'curso'}
          options={[{ value: 'curso', label: 'Curso' }, { value: 'carrera', label: 'Carrera' }, { value: 'diplomado', label: 'Diplomado' }, { value: 'taller', label: 'Taller' }]} />
        <Field label="Categoría o área" name="category" defaultValue={d.category ?? ''} placeholder="Informática, Salud…" />
        <SelectField label="Modalidad" name="modality" required defaultValue={d.modality ?? 'online'} options={[{ value: 'online', label: 'En línea' }, { value: 'in_person', label: 'Presencial' }, { value: 'hybrid', label: 'Híbrido' }]} />
        <SelectField label="Ingreso" name="admission_mode" required defaultValue={d.admission_mode ?? 'direct'}
          options={[{ value: 'direct', label: 'Paga e ingresa al instante' }, { value: 'application', label: 'Postulación y aprobación antes de pagar' }]} />
        <Field label="Precio normal" name="regular_price" type="number" step="0.01" min={0.01} required defaultValue={d.regular_price ?? d.price} />
        <Field label="Descuento % (opcional)" name="discount_pct" type="number" step="0.01" min={0} max={99} defaultValue={d.discount_pct} placeholder="Ej.: 20" />
        <Field label="Descuento válido hasta (opcional)" name="discount_ends_on" type="date" defaultValue={d.discount_ends_on} />
        <Field label="Moneda" name="currency" required defaultValue={d.currency ?? currency} />
        <Field label="Cupos (vacío = sin límite)" name="capacity" type="number" min={1} defaultValue={d.capacity} />
        <Field label="Duración" name="duration_text" defaultValue={d.duration_text} placeholder="8 semanas · 32 horas" />
        <Field label="Horario" name="schedule_text" defaultValue={d.schedule_text} placeholder="Martes y jueves 19:00" />
        <Field label="Fecha de inicio" name="starts_on" type="date" defaultValue={d.starts_on} />
        <SelectField label="Programa al que matricula" name="program_id" required options={programs} defaultValue={d.program_id} />
        <SelectField label="Periodo" name="period_id" required options={periods} defaultValue={d.period_id} />
        <Field label="Orden en el catálogo" name="sort_order" type="number" defaultValue={d.sort_order ?? 0} />
      </Grid>
      <p className="text-xs text-slate-500">El precio con descuento y el total ahorrado se calculan solos y se muestran en el sitio. Al vencer la fecha del descuento se cobra el precio normal.</p>
      <TextArea label="Resumen (tarjeta del catálogo)" name="summary" defaultValue={d.summary} rows={2} />
      <TextArea label="Descripción completa" name="description" defaultValue={d.description} rows={6} />
      <label className="flex items-center gap-2 font-semibold"><input type="checkbox" name="is_published" defaultChecked={!!d.is_published} /> Publicado en el sitio web</label>
    </>
  );
}
