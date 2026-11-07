'use server';
import { revalidatePath } from 'next/cache';
import { getContext } from '@/lib/context';
import { fail, guard, ok, reqStr, str, type ActionResult } from '@/lib/actions';
import { localToIso } from '@/lib/lms';

export async function reserve(fd: FormData): Promise<ActionResult> {
  return guard(async () => {
    const ctx = await getContext();
    const target = reqStr(fd, 'target', 'Sala o recurso'); const [kind, id] = target.split(':');
    const day = reqStr(fd, 'day', 'Fecha');
    const start = localToIso(`${day}T${reqStr(fd, 'start', 'Hora de inicio')}`), end = localToIso(`${day}T${reqStr(fd, 'end', 'Hora de término')}`);
    if (end <= start) return fail('La hora de término debe ser posterior al inicio.');
    if (start < new Date().toISOString()) return fail('No se puede reservar en el pasado.');
    const { error } = await ctx.supabase.from('reservations').insert({
      organization_id: ctx.orgId, room_id: kind === 'room' ? id : null, resource_id: kind === 'res' ? id : null,
      purpose: reqStr(fd, 'purpose', 'Motivo'), during: `[${start},${end})`,
    });
    if (error) {
      if (error.code === '23P01') return fail(error.message.includes('clases') ? error.message : 'Ya existe una reserva en ese horario. Elija otra hora.');
      if (error.code === '42501') return fail('Solo el personal autorizado y los profesores pueden reservar.');
      return fail(error);
    }
    revalidatePath('/app/reservas'); return ok('Reserva confirmada.');
  });
}

export async function cancelReservation(fd: FormData): Promise<ActionResult> {
  return guard(async () => {
    const ctx = await getContext();
    const { error, count } = await ctx.supabase.from('reservations').update({ status: 'cancelada' }, { count: 'exact' }).eq('id', reqStr(fd, 'id', 'id'));
    if (error) return fail(error); if (!count) return fail('No autorizado.');
    revalidatePath('/app/reservas'); return ok('Reserva cancelada.');
  });
}

export async function addResource(fd: FormData): Promise<ActionResult> {
  return guard(async () => {
    const ctx = await getContext();
    const { error } = await ctx.supabase.from('resources').insert({
      organization_id: ctx.orgId, campus_id: str(fd, 'campus_id'), code: reqStr(fd, 'code', 'Código').toUpperCase(), name: reqStr(fd, 'name', 'Nombre'),
      kind: str(fd, 'kind') ?? 'equipo', notes: str(fd, 'notes'),
    });
    if (error) return fail(error);
    revalidatePath('/app/reservas'); return ok('Recurso agregado.');
  });
}

export async function setResourceStatus(fd: FormData): Promise<ActionResult> {
  return guard(async () => {
    const ctx = await getContext();
    const { error, count } = await ctx.supabase.from('resources').update({ status: reqStr(fd, 'status', 'Estado') }, { count: 'exact' }).eq('id', reqStr(fd, 'id', 'id'));
    if (error) return fail(error); if (!count) return fail('No autorizado.');
    revalidatePath('/app/reservas'); return ok('Estado actualizado.');
  });
}
