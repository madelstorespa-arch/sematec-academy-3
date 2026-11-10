'use server';
import { revalidatePath } from 'next/cache';
import { getContext } from '@/lib/context';
import { fail, guard, num, ok, reqStr, str, type ActionResult } from '@/lib/actions';
import { env } from '@/lib/env';

export type InviteInfo = { id: string; url: string; expires_at: string; allow_share: boolean; require_document: boolean; uses: number; max_uses: number | null; label: string | null };
const urlOf = (token: string) => `${env.siteUrl()}/invitado/${token}`;

/** Enlaces vigentes de la sesión (solo anfitrión / moderador / personal con permiso: RLS). */
export async function listInvites(sessionId: string): Promise<InviteInfo[]> {
  const ctx = await getContext();
  if (!/^[0-9a-f-]{36}$/i.test(sessionId)) return [];
  const { data } = await ctx.supabase.from('conference_invites').select('id, token, expires_at, allow_share, require_document, uses, max_uses, label')
    .eq('session_id', sessionId).is('revoked_at', null).gt('expires_at', new Date().toISOString()).order('created_at', { ascending: false });
  return (data ?? []).map((i: any) => ({ id: i.id, url: urlOf(i.token), expires_at: i.expires_at, allow_share: i.allow_share, require_document: i.require_document, uses: i.uses, max_uses: i.max_uses, label: i.label }));
}

/** 🔗 Crea un enlace para que personas sin cuenta entren a la clase o reunión con su nombre, documento y cargo. */
export async function createInvite(fd: FormData): Promise<ActionResult> {
  return guard(async () => {
    const ctx = await getContext();
    const session = reqStr(fd, 'session_id', 'Sesión');
    const { data, error } = await ctx.supabase.rpc('create_conference_invite', {
      p_session: session, p_hours: num(fd, 'hours') ?? 24, p_max_uses: num(fd, 'max_uses'), p_allow_share: fd.get('allow_share') === 'on',
      p_require_document: fd.get('require_document') === 'on', p_label: str(fd, 'label'),
    });
    if (error) return fail(error);
    revalidatePath(`/app/conferencias/${session}`);
    return ok('Enlace creado. Cópielo y compártalo.', { url: urlOf((data as any).token) });
  });
}

export async function revokeInvite(fd: FormData): Promise<ActionResult> {
  return guard(async () => {
    const ctx = await getContext();
    const { error } = await ctx.supabase.rpc('revoke_conference_invite', { p_invite: reqStr(fd, 'id', 'id') });
    if (error) return fail(error);
    const s = str(fd, 'session_id'); if (s) revalidatePath(`/app/conferencias/${s}`);
    return ok('Enlace desactivado: ya nadie puede entrar con él.');
  });
}
