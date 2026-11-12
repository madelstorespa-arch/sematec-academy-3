'use client';
import dynamic from 'next/dynamic';
import type { OfficeDocProps } from './shell';

const Loading = () => <p className="p-8 text-sm text-slate-500">Abriendo el editor…</p>;
const DocEditor = dynamic(() => import('./doc-editor').then((m) => m.DocEditor), { ssr: false, loading: Loading });
const SheetEditor = dynamic(() => import('./sheet-editor').then((m) => m.SheetEditor), { ssr: false, loading: Loading });
const DeckEditor = dynamic(() => import('./deck-editor').then((m) => m.DeckEditor), { ssr: false, loading: Loading });

export function OfficeEditor({ doc }: { doc: OfficeDocProps }) {
  if (doc.kind === 'doc') return <DocEditor doc={doc} />;
  if (doc.kind === 'sheet') return <SheetEditor doc={doc} />;
  return <DeckEditor doc={doc} />;
}
