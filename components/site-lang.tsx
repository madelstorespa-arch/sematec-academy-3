'use client';
import { createContext, useContext, useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { LANG_COOKIE, SITE_LANGS, makeT, type SiteLang, type TFn } from '@/lib/site-i18n-dict';

const Ctx = createContext<{ lang: SiteLang; t: TFn }>({ lang: 'es', t: makeT('es') });

export function SiteLangProvider({ lang, children }: { lang: SiteLang; children: React.ReactNode }) {
  const value = useMemo(() => ({ lang, t: makeT(lang) }), [lang]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const useSiteT = () => useContext(Ctx);

/** Selector de idioma del sitio (se recuerda un año en este navegador). */
export function LangSwitcher({ className = '' }: { className?: string }) {
  const { lang, t } = useSiteT();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [open, setOpen] = useState(false);
  const pick = (l: SiteLang) => {
    document.cookie = `${LANG_COOKIE}=${l}; path=/; max-age=31536000; samesite=lax`;
    document.documentElement.lang = l;
    setOpen(false);
    start(() => router.refresh());
  };
  return (
    <div className={`relative ${className}`} translate="no">
      <button type="button" onClick={() => setOpen((o) => !o)} aria-haspopup="listbox" aria-expanded={open} aria-label={t('lang.label')}
        className="flex items-center gap-1.5 rounded-lg border border-slate-200 px-2.5 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50" data-testid="idioma-sitio">
        <span aria-hidden>🌐</span>{SITE_LANGS.find(([c]) => c === lang)?.[2]}{pending && <span className="animate-pulse">…</span>}
      </button>
      {open && (
        <ul role="listbox" className="absolute right-0 z-50 mt-2 w-40 overflow-hidden rounded-xl border border-slate-200 bg-white py-1 text-sm shadow-xl">
          {SITE_LANGS.map(([c, name, short]) => (
            <li key={c}>
              <button type="button" role="option" aria-selected={c === lang} onClick={() => pick(c)} data-testid={`idioma-${c}`}
                className={`flex w-full items-center justify-between px-3 py-2 text-left hover:bg-slate-50 ${c === lang ? 'font-bold text-brand-700' : ''}`}>
                {name}<span className="text-xs text-slate-400">{short}</span>
              </button>
            </li>))}
        </ul>
      )}
    </div>
  );
}
