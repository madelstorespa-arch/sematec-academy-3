'use server';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

export async function switchOrg(fd: FormData) {
  const id = String(fd.get('org') ?? '');
  if (/^[0-9a-f-]{36}$/.test(id)) {
    (await cookies()).set('sa_org', id, { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', path: '/', maxAge: 60 * 60 * 24 * 365 });
  }
  redirect('/app');
}
