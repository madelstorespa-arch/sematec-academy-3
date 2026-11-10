'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { LOCALES, RTL } from '@/lib/i18n';

/**
 * 🌐 Traduce la plataforma al idioma de ESTA persona, en su propio navegador (Chrome / Edge, sin costo):
 * textos, tablas, botones, chat, subtítulos de la clase y todo lo que aparece después. No cambia nada
 * para los demás usuarios ni los datos guardados.
 */
type T = { translate: (s: string) => Promise<string>; destroy?: () => void };
const SKIP = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'CODE', 'PRE', 'TEXTAREA', 'INPUT', 'SVG', 'KBD', 'VIDEO', 'AUDIO', 'CANVAS']);
const ATTRS = ['placeholder', 'title', 'aria-label'];
const worth = (s: string) => {
  const t = s.trim();
  return t.length >= 2 && /\p{L}{2}/u.test(t) && !/^[\w.+-]+@[\w-]+\.[\w.]+$/.test(t) && !/^https?:\/\//.test(t) && !/^[A-Z]{4}\d{6}$/.test(t) && t.length <= 4000;
};

export function PageTranslator({ locale }: { locale: string }) {
  const [state, setState] = useState<'off' | 'unsupported' | 'need-click' | 'downloading' | 'on' | 'original'>('off');
  const [pct, setPct] = useState(0);
  const tr = useRef<T | null>(null);
  const cache = useRef(new Map<string, string>());
  const orig = useRef(new WeakMap<Node, { o: string; t: string }>());
  const origAttr = useRef(new WeakMap<Element, Record<string, { o: string; t: string }>>());
  const busy = useRef(false); const again = useRef(false); const showOriginal = useRef(false);
  const name = LOCALES.find(([c]) => c === locale)?.[1] ?? locale;
  const key = `sematec-tr-${locale}`;

  const t1 = useCallback(async (s: string) => {
    const k = s.trim(); const hit = cache.current.get(k); if (hit !== undefined) return s.replace(k, hit);
    try { const out = await tr.current!.translate(k); cache.current.set(k, out); return s.replace(k, out); } catch { return s; }
  }, []);

  const run = useCallback(async () => {
    if (!tr.current || showOriginal.current) return;
    if (busy.current) { again.current = true; return; }
    busy.current = true;
    try {
      const nodes: Text[] = [];
      const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
        acceptNode: (n) => {
          for (let p = n.parentElement; p; p = p.parentElement) {
            if (SKIP.has(p.tagName.toUpperCase()) || p.getAttribute('translate') === 'no' || p.classList.contains('notranslate') || p.isContentEditable) return NodeFilter.FILTER_REJECT;
            if (p === document.body) break;
          }
          const v = n.nodeValue ?? ''; const m = orig.current.get(n);
          if (m && m.t === v) return NodeFilter.FILTER_REJECT; // ya traducido
          return worth(v) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
        },
      });
      for (let n = w.nextNode(); n && nodes.length < 3000; n = w.nextNode()) nodes.push(n as Text);
      for (const n of nodes) {
        const v = n.nodeValue ?? '';
        const out = await t1(v);
        if (n.nodeValue === v && out !== v) { orig.current.set(n, { o: v, t: out }); n.nodeValue = out; }
      }
      for (const el of Array.from(document.body.querySelectorAll<HTMLElement>('[placeholder],[title],[aria-label]')).slice(0, 1500)) {
        if (el.closest('[translate=no],.notranslate')) continue;
        const rec = origAttr.current.get(el) ?? {};
        for (const a of ATTRS) {
          const v = el.getAttribute(a); if (!v || !worth(v) || rec[a]?.t === v) continue;
          const out = await t1(v); if (out !== v) { rec[a] = { o: v, t: out }; el.setAttribute(a, out); }
        }
        origAttr.current.set(el, rec);
      }
      try { sessionStorage.setItem(key, JSON.stringify([...cache.current].slice(-4000))); } catch { /* lleno */ }
    } finally {
      busy.current = false;
      if (again.current) { again.current = false; setTimeout(run, 200); }
    }
  }, [t1, key]);

  const start = useCallback(async (userClick: boolean) => {
    const API = (self as any).Translator;
    if (!API) { setState('unsupported'); return; }
    try {
      const a = await API.availability({ sourceLanguage: 'es', targetLanguage: locale });
      if (a === 'unavailable') { setState('unsupported'); return; }
      if (a !== 'available' && !userClick) { setState('need-click'); return; }
      setState(a === 'available' ? 'on' : 'downloading');
      tr.current = await API.create({ sourceLanguage: 'es', targetLanguage: locale,
        monitor: (m: any) => m.addEventListener('downloadprogress', (e: any) => setPct(Math.round((e.loaded ?? 0) * 100))) });
      setState('on'); document.documentElement.lang = locale; document.documentElement.dir = RTL.has(locale) ? 'rtl' : 'ltr';
      run();
    } catch { setState('unsupported'); }
  }, [locale, run]);

  useEffect(() => {
    if (locale === 'es') { document.documentElement.lang = 'es'; document.documentElement.dir = 'ltr'; return; }
    try { cache.current = new Map(JSON.parse(sessionStorage.getItem(key) ?? '[]')); } catch { /* */ }
    start(false);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const mo = new MutationObserver(() => { clearTimeout(timer); timer = setTimeout(run, 300); });
    mo.observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ATTRS });
    return () => { mo.disconnect(); clearTimeout(timer); tr.current?.destroy?.(); tr.current = null; };
  }, [locale, key, start, run]);

  const toggleOriginal = () => {
    showOriginal.current = !showOriginal.current;
    const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let n = w.nextNode(); n; n = w.nextNode()) {
      const m = orig.current.get(n); if (!m) continue;
      n.nodeValue = showOriginal.current ? m.o : m.t;
    }
    setState(showOriginal.current ? 'original' : 'on');
    if (!showOriginal.current) run();
  };

  if (locale === 'es' || state === 'off') return null;
  return (
    <div className="notranslate fixed bottom-14 left-3 z-50 flex max-w-[92vw] items-center gap-2 rounded-full border border-slate-200 bg-white/95 px-3 py-1.5 text-xs shadow-lg print:hidden" translate="no" data-testid="traductor">
      🌐
      {state === 'on' && <><span>{name}</span><button className="underline" onClick={toggleOriginal}>Ver original (español)</button></>}
      {state === 'original' && <><span>Español (original)</span><button className="underline" onClick={toggleOriginal}>Traducir a {name}</button></>}
      {state === 'need-click' && <button className="font-semibold text-brand-700 underline" onClick={() => start(true)} data-testid="activar-traduccion">Traducir la plataforma a {name}</button>}
      {state === 'downloading' && <span>Preparando el traductor ({name})… {pct}%</span>}
      {state === 'unsupported' && <span>El menú está en {name}. Para traducir el resto, use Chrome o Edge actualizado, o «⋮ → Traducir» del navegador.</span>}
    </div>
  );
}
