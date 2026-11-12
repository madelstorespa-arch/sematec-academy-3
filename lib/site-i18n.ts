import 'server-only';
import { cookies } from 'next/headers';
import { LANG_COOKIE, isSiteLang, makeT, type SiteLang } from '@/lib/site-i18n-dict';

/** Idioma elegido por el visitante en el sitio público (cookie «sitio-lang»; por defecto español). */
export async function getLang(): Promise<SiteLang> {
  try {
    const v = (await cookies()).get(LANG_COOKIE)?.value;
    return isSiteLang(v) ? v : 'es';
  } catch { return 'es'; }
}

export async function getT() {
  return makeT(await getLang());
}
