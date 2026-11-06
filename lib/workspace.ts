/**
 * Integración con Google Workspace (Admin SDK Directory API) para crear buzones
 * institucionales reales (@dominio) a profesores y estudiantes.
 *
 * Variables de entorno (solo servidor, nunca NEXT_PUBLIC_):
 *   GOOGLE_WORKSPACE_DOMAIN          dominio verificado en Workspace (ej. sematecacademy.cl)
 *   GOOGLE_WORKSPACE_ADMIN_EMAIL     superadministrador al que suplanta la cuenta de servicio
 *   GOOGLE_SERVICE_ACCOUNT_JSON      JSON completo de la clave de la cuenta de servicio
 *                                    (con delegación de todo el dominio y el alcance admin.directory.user)
 */
import crypto from 'node:crypto';

const SCOPE = 'https://www.googleapis.com/auth/admin.directory.user';

export function workspaceDomain(): string | null {
  const d = (process.env.GOOGLE_WORKSPACE_DOMAIN ?? '').trim().toLowerCase();
  return d || null;
}

export function workspaceEnabled(): boolean {
  return !!workspaceDomain() && !!process.env.GOOGLE_WORKSPACE_ADMIN_EMAIL && !!process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
}

function b64url(input: Buffer | string) {
  return Buffer.from(input).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
}

async function accessToken(): Promise<string> {
  let sa: { client_email?: string; private_key?: string; token_uri?: string };
  try { sa = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON ?? ''); } catch { throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON no es un JSON válido.'); }
  if (!sa.client_email || !sa.private_key) throw new Error('La clave de la cuenta de servicio está incompleta.');
  const tokenUrl = process.env.GOOGLE_OAUTH_URL || sa.token_uri || 'https://oauth2.googleapis.com/token';
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claims = b64url(JSON.stringify({
    iss: sa.client_email, sub: process.env.GOOGLE_WORKSPACE_ADMIN_EMAIL, scope: SCOPE, aud: tokenUrl, iat: now, exp: now + 3600,
  }));
  const signature = b64url(crypto.sign('RSA-SHA256', Buffer.from(`${header}.${claims}`), sa.private_key));
  const res = await fetch(tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${header}.${claims}.${signature}` }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.access_token) throw new Error(`Google rechazó la autorización (${body.error ?? res.status}). Revise la delegación de dominio y el alcance.`);
  return body.access_token as string;
}

/** "José Ignacio" + "Pérez Soto" → "jose.perez" */
export function addressLocalPart(firstNames: string, lastNames: string): string {
  const clean = (s: string) => (s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().split(/\s+/).find(Boolean) ?? '')
    .replace(/ñ/g, 'n').replace(/[^a-z0-9]/g, '');
  const local = [clean(firstNames), clean(lastNames)].filter(Boolean).join('.');
  if (!local) throw new Error('No se pudo generar la dirección a partir del nombre.');
  return local;
}

/**
 * Crea el buzón en Google Workspace. Si la dirección ya existe, prueba con sufijos numéricos.
 * Google pedirá cambiar la contraseña en el primer ingreso.
 */
export async function createWorkspaceUser(p: { firstNames: string; lastNames: string; password: string }): Promise<string> {
  const domain = workspaceDomain();
  if (!workspaceEnabled() || !domain) throw new Error('Google Workspace no está configurado.');
  const token = await accessToken();
  const api = process.env.GOOGLE_DIRECTORY_URL || 'https://admin.googleapis.com/admin/directory/v1/users';
  const base = addressLocalPart(p.firstNames, p.lastNames);
  for (let i = 1; i <= 9; i++) {
    const primaryEmail = `${base}${i === 1 ? '' : i}@${domain}`;
    const res = await fetch(api, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        primaryEmail, password: p.password, changePasswordAtNextLogin: true,
        name: { givenName: p.firstNames.trim(), familyName: p.lastNames.trim() },
      }),
    });
    if (res.ok) return primaryEmail;
    const body = await res.json().catch(() => ({}));
    if (res.status === 409) continue; // la dirección ya existe
    throw new Error(`Google Workspace no pudo crear el correo: ${body?.error?.message ?? res.status}`);
  }
  throw new Error('No hay direcciones disponibles para ese nombre.');
}
