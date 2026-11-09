'use server';
import { revalidatePath } from 'next/cache';
import { getContext } from '@/lib/context';
import { fail, guard, ok, type ActionResult } from '@/lib/actions';
import { runInstall } from '@/lib/setup/install';

/** ⬆ Instala las mejoras pendientes de la base de datos (solo superadministrador con verificación en dos pasos). */
export async function installUpdates(): Promise<ActionResult> {
  return guard(async () => {
    const ctx = await getContext();
    if (!ctx.isPlatformAdmin) return fail('Solo el superadministrador puede actualizar el sistema.');
    if (ctx.aal !== 'aal2') return fail('Por seguridad, primero verifique su identidad con el código de dos pasos (MFA).');
    if (!process.env.DATABASE_URL) return fail('Falta la variable DATABASE_URL en Vercel (vea las instrucciones en esta página).');
    try {
      const log = await runInstall(false);
      const done = log.filter((l) => l.startsWith('✓')).length;
      console.info(`[actualizar] ${ctx.user.email}: ${done} mejoras instaladas`);
      revalidatePath('/app', 'layout');
      return ok(done ? `Sistema actualizado: ${done} mejora${done > 1 ? 's' : ''} instalada${done > 1 ? 's' : ''}.` : 'El sistema ya estaba al día.', log);
    } catch (e) {
      return fail(`No se pudo completar la actualización: ${(e as Error).message}. No se aplicó ningún cambio parcial de esa mejora.`);
    }
  });
}
