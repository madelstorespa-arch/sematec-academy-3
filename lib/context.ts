import 'server-only';
import { cache } from 'react';
import { cookies } from 'next/headers';
import { notFound, redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';

export type OrgSummary = { organization_id: string; display_name: string; slug: string; roles: string[]; requires_mfa: boolean };

/** Contexto de la solicitud: usuario, institución activa, permisos efectivos y vínculos académicos. */
export const getContext = cache(async () => {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const [{ data: profile }, { data: aal }, { data: orgsData }] = await Promise.all([
    supabase.from('profiles').select('*').eq('id', user.id).maybeSingle(),
    supabase.auth.mfa.getAuthenticatorAssuranceLevel(),
    supabase.rpc('my_organizations'),
  ]);
  const orgs = (orgsData ?? []) as OrgSummary[];
  const chosen = (await cookies()).get('sa_org')?.value;
  const org = orgs.find((o) => o.organization_id === chosen) ?? orgs[0] ?? null;

  let perms: string[] = [];
  let studentId: string | null = null;
  let teacherId: string | null = null;
  let isEmployee = false;
  let isGuardian = false;
  if (org) {
    const [p, s, t, e, g] = await Promise.all([
      supabase.rpc('my_permissions', { p_org: org.organization_id }),
      supabase.from('students').select('id').eq('organization_id', org.organization_id).eq('user_id', user.id).maybeSingle(),
      supabase.from('teachers').select('id').eq('organization_id', org.organization_id).eq('user_id', user.id).maybeSingle(),
      supabase.from('employees').select('id').eq('organization_id', org.organization_id).eq('user_id', user.id).maybeSingle(),
      supabase.from('guardian_links').select('id').eq('organization_id', org.organization_id).eq('guardian_id', user.id).eq('status', 'activo').limit(1),
    ]);
    isGuardian = !!g.data?.length;
    isEmployee = !!e.data;
    perms = (p.data ?? []) as string[];
    studentId = s.data?.id ?? null;
    teacherId = t.data?.id ?? null;
  }
  const isPlatformAdmin = !!profile?.is_platform_admin;
  return {
    supabase,
    user,
    profile,
    aal: (aal?.currentLevel ?? 'aal1') as string,
    hasMfaFactor: aal?.nextLevel === 'aal2',
    orgs,
    org,
    orgId: org?.organization_id ?? null,
    perms: new Set(perms),
    isPlatformAdmin,
    studentId,
    teacherId,
    isEmployee,
    isGuardian,
    needsMfa: (isPlatformAdmin || !!org?.requires_mfa) && aal?.currentLevel !== 'aal2',
  };
});

export type Ctx = Awaited<ReturnType<typeof getContext>>;

export const can = (ctx: Ctx, perm: string) => ctx.perms.has(perm);

/** Exige permiso; si falta, responde 404 para no revelar la existencia del recurso. */
export function requirePerm(ctx: Ctx, ...anyOf: string[]) {
  if (!anyOf.some((p) => ctx.perms.has(p))) notFound();
}

export function requireOrg(ctx: Ctx): string {
  if (!ctx.orgId) redirect('/app');
  return ctx.orgId;
}
