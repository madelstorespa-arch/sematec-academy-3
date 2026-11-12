import 'server-only';
import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * 🔌 Conexión opcional con ONLYOFFICE Docs (servidor propio de la institución).
 * Se activa con dos variables SOLO del servidor (Vercel → Settings → Environment Variables):
 *   ONLYOFFICE_URL         https://docs.su-institucion.cl  (sin barra final)
 *   ONLYOFFICE_JWT_SECRET  el mismo secreto JWT configurado en el servidor ONLYOFFICE
 * Si faltan, la Oficina sigue funcionando con su editor propio.
 */
export function onlyofficeUrl(): string | null {
  const u = (process.env.ONLYOFFICE_URL ?? '').trim().replace(/\/+$/, '');
  if (!u || !process.env.ONLYOFFICE_JWT_SECRET) return null;
  try {
    const x = new URL(u);
    // Siempre HTTPS; http solo para pruebas en este mismo equipo
    const ok = x.protocol === 'https:' || (x.protocol === 'http:' && (process.env.NODE_ENV !== 'production' || ['localhost', '127.0.0.1'].includes(x.hostname)));
    return ok ? x.origin + x.pathname.replace(/\/+$/, '') : null;
  } catch { return null; }
}
export const onlyofficeEnabled = () => onlyofficeUrl() !== null;
const secret = () => process.env.ONLYOFFICE_JWT_SECRET ?? '';

const b64u = (b: Buffer | string) => Buffer.from(b).toString('base64url');
/** JWT HS256 (formato que exige ONLYOFFICE). */
export function signJwt(payload: object, ttlSec = 6 * 3600): string {
  const now = Math.floor(Date.now() / 1000);
  const h = b64u(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const p = b64u(JSON.stringify({ ...payload, iat: now, exp: now + ttlSec }));
  return `${h}.${p}.${b64u(createHmac('sha256', secret()).update(`${h}.${p}`).digest())}`;
}
export function verifyJwt<T = Record<string, unknown>>(token: string | null | undefined): T | null {
  if (!token || !secret()) return null;
  const [h, p, s] = token.split('.');
  if (!h || !p || !s) return null;
  try {
    const head = JSON.parse(Buffer.from(h, 'base64url').toString());
    if (head.alg !== 'HS256') return null;
    const want = createHmac('sha256', secret()).update(`${h}.${p}`).digest();
    const got = Buffer.from(s, 'base64url');
    if (got.length !== want.length || !timingSafeEqual(got, want)) return null;
    const body = JSON.parse(Buffer.from(p, 'base64url').toString());
    if (typeof body.exp === 'number' && body.exp < Date.now() / 1000) return null;
    return body as T;
  } catch { return null; }
}

/** Firma corta para las direcciones que llama el servidor ONLYOFFICE (descarga y aviso de guardado). */
export function linkSig(purpose: 'file' | 'cb', docId: string, exp: number, extra = '') {
  return createHmac('sha256', secret()).update(`${purpose}|${docId}|${exp}|${extra}`).digest('base64url');
}
export function checkLinkSig(purpose: 'file' | 'cb', docId: string, exp: string | null, sig: string | null, extra = '') {
  const e = Number(exp);
  if (!sig || !Number.isFinite(e) || e < Date.now() / 1000) return false;
  const want = Buffer.from(linkSig(purpose, docId, e, extra)); const got = Buffer.from(sig);
  return want.length === got.length && timingSafeEqual(want, got);
}

export const OO_EXT: Record<string, { kind: 'doc' | 'sheet' | 'slides'; type: 'word' | 'cell' | 'slide'; mime: string }> = {
  docx: { kind: 'doc', type: 'word', mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' },
  odt: { kind: 'doc', type: 'word', mime: 'application/vnd.oasis.opendocument.text' },
  rtf: { kind: 'doc', type: 'word', mime: 'application/rtf' },
  txt: { kind: 'doc', type: 'word', mime: 'text/plain' },
  xlsx: { kind: 'sheet', type: 'cell', mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' },
  ods: { kind: 'sheet', type: 'cell', mime: 'application/vnd.oasis.opendocument.spreadsheet' },
  csv: { kind: 'sheet', type: 'cell', mime: 'text/csv' },
  pptx: { kind: 'slides', type: 'slide', mime: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' },
  odp: { kind: 'slides', type: 'slide', mime: 'application/vnd.oasis.opendocument.presentation' },
};
export type OOContent = { oo: { path: string; ext: string; size?: number; key?: string } };
export const isOO = (c: unknown): c is OOContent => !!c && typeof c === 'object' && !!(c as OOContent).oo?.path;
export const OO_MAX_BYTES = 50 * 1024 * 1024;

/** Dirección pública de esta plataforma que usará el servidor ONLYOFFICE (por defecto, la del sitio). */
export function appBaseUrl(fallback: string) {
  const u = (process.env.ONLYOFFICE_APP_URL ?? '').trim().replace(/\/+$/, '');
  return /^https?:\/\//.test(u) ? u : fallback.replace(/\/+$/, '');
}

/** Configuración firmada del editor ONLYOFFICE para un documento. */
export function editorConfig(o: {
  base: string; id: string; title: string; content: OOContent; access: 'owner' | 'editor' | 'commenter' | 'viewer';
  user: { id: string; name: string };
}) {
  const { path, ext } = o.content.oo;
  const key = (o.content.oo.key ?? path).replace(/[^0-9A-Za-z_-]/g, '').slice(-120);
  const now = Math.floor(Date.now() / 1000);
  const fe = now + 12 * 3600; const ce = now + 7 * 86400;
  const canEdit = o.access === 'owner' || o.access === 'editor';
  const config: Record<string, unknown> = {
    document: {
      fileType: ext, key, title: `${o.title}.${ext}`,
      url: `${o.base}/api/oficina/onlyoffice/archivo/${o.id}?p=${encodeURIComponent(path)}&e=${fe}&s=${linkSig('file', o.id, fe, path)}`,
      permissions: { edit: canEdit, comment: o.access !== 'viewer', review: canEdit, download: true, print: true, copy: true },
    },
    documentType: OO_EXT[ext]?.type ?? 'word',
    editorConfig: {
      callbackUrl: `${o.base}/api/oficina/onlyoffice/callback/${o.id}?e=${ce}&s=${linkSig('cb', o.id, ce)}`,
      lang: 'es', region: 'es-CL', mode: o.access === 'viewer' ? 'view' : 'edit',
      user: { id: o.user.id, name: o.user.name },
      customization: { forcesave: true, autosave: true, comments: true, goback: { url: `${o.base}/app/oficina`, text: 'Volver a SEMATEC Oficina' } },
    },
    width: '100%', height: '100%',
  };
  config.token = signJwt(config, 12 * 3600);
  return config;
}
