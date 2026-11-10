'use client';
import { useState } from 'react';
import { ActionForm, Field, Grid, SelectField } from '@/components/forms';

type R = { ok: boolean; message?: string; error?: string };

/**
 * Aprobar o rechazar una solicitud. El resultado (con la contraseña temporal, que se muestra
 * una sola vez) queda a la vista aunque la solicitud ya aparezca como resuelta.
 */
export function RequestDecision({ id, pending, wants, slug, approve, reject }: {
  id: string; pending: boolean; wants: string; slug: string;
  approve: (fd: FormData) => Promise<R>; reject: (fd: FormData) => Promise<R>;
}) {
  const [done, setDone] = useState<string | null>(null);
  if (!pending) return done ? <p role="status" data-testid="resultado-solicitud" className="mt-3 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800">✓ {done}</p> : null;
  const keep = (r: R) => { if (r.ok && r.message) setDone(r.message); };
  return (
    <div className="mt-3 grid gap-3 lg:grid-cols-2">
      <ActionForm action={approve} submitLabel="✅ Aprobar y crear" resetOnSuccess={false} onDone={keep}>
        <input type="hidden" name="request" value={id} />
        {wants !== 'independiente' && <Grid cols={2}>
          <Field label="Enlace" name="slug" defaultValue={slug} />
          <SelectField label="Tipo" name="platform_mode" defaultValue={wants === 'completo' ? 'completo' : 'aula'} options={[{ value: 'aula', label: '🎥 Solo aula virtual' }, { value: 'completo', label: '🏛 Sistema completo' }]} />
        </Grid>}
        <Field label="Nota (opcional)" name="note" />
      </ActionForm>
      <ActionForm action={reject} submitLabel="Rechazar" submitClass="btn-secondary" confirm="¿Rechazar esta solicitud?" onDone={keep}>
        <input type="hidden" name="request" value={id} /><Field label="Motivo (opcional)" name="note" />
      </ActionForm>
    </div>
  );
}
