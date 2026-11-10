import Link from 'next/link';
import { mediaUrl } from '@/lib/site';
import { fmtDate } from '@/lib/format';
import { PriceTag } from '@/components/price-tag';
import { KIND_LABEL } from '@/lib/pricing';
import { AVAIL_TEXT, type Avail } from '@/lib/availability';

export const MODALITY: Record<string, string> = { online: 'En línea', in_person: 'Presencial', hybrid: 'Híbrido' };

export function CourseCard({ c, avail }: { c: any; avail?: Avail }) {
  const closed = avail?.status === 'agotado' || avail?.status === 'cerrado';
  const img = mediaUrl(c.image_asset_id);
  return (
    <Link href={`/cursos/${c.slug}`} className="card group flex flex-col overflow-hidden transition hover:-translate-y-0.5 hover:shadow-md">
      {img
        // eslint-disable-next-line @next/next/no-img-element
        ? <img src={img} alt={c.title} className="h-44 w-full object-cover" />
        : <div className="h-44 w-full bg-gradient-to-br from-brand-600 to-accent" />}
      <div className="flex flex-1 flex-col p-5">
        <p className="text-xs font-bold uppercase tracking-wider text-brand-600">{[KIND_LABEL[c.kind] ?? 'Curso', c.category && !Object.values(KIND_LABEL).includes(c.category) ? c.category : null, MODALITY[c.modality]].filter(Boolean).join(' · ')}</p>
        <h3 className="mt-1 text-lg font-bold group-hover:text-brand-700">{c.title}</h3>
        <p className="mt-2 line-clamp-3 flex-1 text-sm text-slate-600">{c.summary}</p>
        {avail && <p className={`mt-2 text-xs font-semibold ${AVAIL_TEXT[avail.status][1]}`} data-testid="cupos">{AVAIL_TEXT[avail.status][0]}{avail.capacity && avail.status !== 'cerrado' ? ` · ${Math.max(0, avail.capacity - avail.taken)} de ${avail.capacity} cupos` : ''}</p>}
        <div className="mt-4 flex items-end justify-between">
          <div><PriceTag c={c} />{c.starts_on && <p className="text-xs text-slate-500">Inicio {fmtDate(c.starts_on)}</p>}</div>
          <span className={closed ? 'btn-secondary btn-sm' : 'btn-primary btn-sm'}>{closed ? 'Ver detalle' : c.admission_mode === 'application' ? 'Postular' : 'Inscribirme'}</span>
        </div>
      </div>
    </Link>
  );
}
