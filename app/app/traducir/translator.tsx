'use client';
import { useState } from 'react';
import { LOCALES } from '@/lib/i18n';

/** 🌐 Traductor de textos y documentos: el texto se traduce en el navegador de la persona (Chrome / Edge), sin costo. */
export function DocTranslator({ locale, files }: { locale: string; files: { id: string; name: string }[] }) {
  const [src, setSrc] = useState('es');
  const [dst, setDst] = useState(locale === 'es' ? 'en' : locale);
  const [text, setText] = useState('');
  const [out, setOut] = useState('');
  const [name, setName] = useState('texto');
  const [msg, setMsg] = useState<{ ok: boolean; t: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [pct, setPct] = useState(0);

  const load = async (body: FormData | string) => {
    setBusy(true); setMsg(null);
    try {
      const r = await fetch('/api/traducir/extraer', typeof body === 'string'
        ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ file: body }) } : { method: 'POST', body });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? 'No se pudo leer el documento.');
      setText(j.text); setName(String(j.name).replace(/\.[^.]+$/, '')); setOut('');
      setMsg({ ok: true, t: `Documento cargado (${j.text.length.toLocaleString('es-CL')} caracteres)${j.truncated ? ' — se usará solo el inicio, el documento es muy largo' : ''}.` });
    } catch (e) { setMsg({ ok: false, t: (e as Error).message }); } finally { setBusy(false); }
  };

  const translate = async () => {
    const API = (self as any).Translator;
    if (!text.trim()) { setMsg({ ok: false, t: 'Escriba o cargue un texto.' }); return; }
    if (src === dst) { setOut(text); return; }
    if (!API) { setMsg({ ok: false, t: 'Su navegador no tiene traductor incorporado. Use Google Chrome o Microsoft Edge actualizado en un computador.' }); return; }
    setBusy(true); setMsg(null); setPct(0);
    try {
      const a = await API.availability({ sourceLanguage: src, targetLanguage: dst });
      if (a === 'unavailable') throw new Error('Su navegador no puede traducir entre esos dos idiomas.');
      if (a !== 'available') setMsg({ ok: true, t: 'Preparando el traductor de su navegador (solo la primera vez, puede tardar un poco)…' });
      const t = await API.create({ sourceLanguage: src, targetLanguage: dst, monitor: (m: any) => m.addEventListener('downloadprogress', (e: any) => setPct(Math.round((e.loaded ?? 0) * 100))) });
      // Por párrafos: el traductor funciona mejor con trozos cortos y se ve el avance
      const parts = text.split(/\n{2,}/); const res: string[] = [];
      for (let i = 0; i < parts.length; i++) {
        const p = parts[i];
        res.push(p.trim() ? await t.translate(p.length > 4000 ? p.slice(0, 4000) : p) : p);
        setOut(res.join('\n\n')); setPct(Math.round(((i + 1) / parts.length) * 100));
      }
      t.destroy?.();
      setMsg({ ok: true, t: '✓ Traducción lista.' });
    } catch (e) { setMsg({ ok: false, t: (e as Error).message || 'No se pudo traducir.' }); } finally { setBusy(false); }
  };

  const download = () => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([out], { type: 'text/plain;charset=utf-8' }));
    a.download = `${name} (${dst}).txt`.replace(/[\\/:*?"<>|]/g, '-'); a.click();
  };
  const sel = (v: string, set: (s: string) => void, label: string) => (
    <label className="block"><span className="label">{label}</span>
      <select value={v} onChange={(e) => set(e.target.value)} className="input">{LOCALES.map(([c, n, f]) => <option key={c} value={c}>{f} {n}</option>)}</select></label>);
  return (
    <div className="space-y-4 notranslate" translate="no" data-testid="traductor-documentos">
      <div className="grid gap-3 sm:grid-cols-[1fr_auto_1fr] sm:items-end">
        {sel(src, setSrc, 'Desde')}
        <button type="button" className="btn-secondary" onClick={() => { setSrc(dst); setDst(src); setText(out || text); setOut(''); }} title="Invertir">⇄</button>
        {sel(dst, setDst, 'Hacia')}
      </div>
      <div className="flex flex-wrap items-end gap-2">
        <label className="block"><span className="label">📄 Subir documento (PDF, Word, texto, subtítulos .srt)</span>
          <input type="file" accept=".pdf,.docx,.txt,.md,.csv,.html,.htm,.srt,.vtt,.json" className="text-sm" data-testid="doc-traducir"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) { const fd = new FormData(); fd.append('file', f); load(fd); } e.target.value = ''; }} /></label>
        {files.length > 0 && <label className="block"><span className="label">📁 O uno de «Mis archivos»</span>
          <select className="input" defaultValue="" onChange={(e) => { if (e.target.value) load(e.target.value); }}>
            <option value="">— Elegir —</option>{files.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}</select></label>}
      </div>
      <div className="grid gap-3 lg:grid-cols-2">
        <textarea value={text} onChange={(e) => setText(e.target.value)} rows={16} className="input font-sans" placeholder="Escriba o pegue aquí el texto…" maxLength={200000} data-testid="texto-original" />
        <textarea value={out} readOnly rows={16} className="input bg-slate-50 font-sans" placeholder="Aquí aparece la traducción" data-testid="texto-traducido" />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className="btn-primary" disabled={busy} onClick={translate} data-testid="boton-traducir">{busy ? `Traduciendo… ${pct}%` : '🌐 Traducir'}</button>
        {out && <><button type="button" className="btn-secondary" onClick={() => navigator.clipboard?.writeText(out)}>📋 Copiar</button>
          <button type="button" className="btn-secondary" onClick={download}>⬇ Descargar traducción (.txt)</button></>}
      </div>
      {msg && <p className={`rounded-lg px-3 py-2 text-sm ${msg.ok ? 'bg-emerald-50 text-emerald-800' : 'bg-red-50 text-red-700'}`} role="status" data-testid="estado-traduccion">{msg.t}</p>}
    </div>
  );
}
