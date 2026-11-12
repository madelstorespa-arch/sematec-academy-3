import Link from 'next/link';
import { mediaUrl } from '@/lib/site';
import { fmtDate } from '@/lib/format';
import { PriceTag } from '@/components/price-tag';
import { type Avail } from '@/lib/availability';
import { makeT, type TFn } from '@/lib/site-i18n-dict';

export const MODALITY: Record<string, string> = { online: 'En línea', in_person: 'Presencial', hybrid: 'Híbrido' };
const ES = makeT('es');
const AVAIL_CLS: Record<Avail['status'], string> = { disponible: 'text-emerald-700', ultimos: 'text-amber-600', agotado: 'text-red-600', cerrado: 'text-slate-500' };
export const availText = (a: Avail, t: TFn = ES, long = false) =>
  t(`avail.${a.status}`) + (a.capacity && a.status !== 'cerrado' ? ` · ${t(long ? 'avail.left' : 'avail.short', { n: Math.max(0, a.capacity - a.taken), cap: a.capacity })}` : '');
export const availClass = (a: Avail) => AVAIL_CLS[a.status];

export function CourseCard({ c, avail, t = ES }: { c: any; avail?: Avail; t?: TFn }) {
  const closed = avail?.status === 'agotado' || avail?.status === 'cerrado';
  const img = mediaUrl(c.image_asset_id);
  const kind = c.kind ?? 'curso';
  const kindLabel = t(`kind.${kind}`);
  const cat = c.category && !['Curso', 'Carrera', 'Diplomado', 'Taller', kindLabel].includes(c.category) ? c.category : null;
  return (
    <Link href={`/cursos/${c.slug}`} className="card group flex flex-col overflow-hidden transition duration-300 hover:-translate-y-1 hover:shadow-xl" data-testid="tarjeta-curso">
      <div className="relative">
        {img
          // eslint-disable-next-line @next/next/no-img-element
          ? <img src={img} alt={c.title} className="h-48 w-full object-cover transition duration-500 group-hover:scale-[1.03]" />
          : <div className="h-48 w-full bg-gradient-to-br from-brand-600 via-brand-500 to-accent" />}
        <span className="absolute left-3 top-3 rounded-full bg-white/95 px-3 py-1 text-xs font-bold text-brand-700 shadow-sm">{kindLabel}</span>
        {c.modality && <span className="absolute right-3 top-3 rounded-full bg-ink/80 px-3 py-1 text-xs font-semibold text-white">{t(`mod.${c.modality}`)}</span>}
      </div>
      <div className="flex flex-1 flex-col p-6">
        {cat && <p className="text-xs font-bold uppercase tracking-wider text-brand-600">{cat}</p>}
        <h3 className="mt-1 text-lg font-bold leading-snug group-hover:text-brand-700">{c.title}</h3>
        <p className="mt-2 line-clamp-3 flex-1 text-sm text-slate-600" translate="yes">{c.summary}</p>
        {avail && <p className={`mt-3 text-xs font-semibold ${availClass(avail)}`} data-testid="cupos">{availText(avail, t)}</p>}
        <div className="mt-4 flex items-end justify-between gap-3 border-t border-slate-100 pt-4">
          <div><PriceTag c={c} t={t} />{c.starts_on && <p className="text-xs text-slate-500">{t('card.starts', { date: fmtDate(c.starts_on) })}</p>}</div>
          <span className={closed ? 'btn-secondary btn-sm shrink-0' : 'btn-primary btn-sm shrink-0'}>{closed ? t('card.details') : c.admission_mode === 'application' ? t('card.apply') : t('card.enroll')}</span>
        </div>
      </div>
    </Link>
  );
}
