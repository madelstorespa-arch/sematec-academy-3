import Link from 'next/link';
import { getContext, can, requireOrg } from '@/lib/context';
import { prefsOf } from '@/lib/prefs';
import { LOCALES } from '@/lib/i18n';
import { SALE_METHODS } from '@/lib/store';
import { buildNav } from '@/lib/nav-items';
import { Tabs } from '@/components/ui';
import { OwnerActions } from '@/components/owner-actions';
import { MailStatus } from '@/components/mail-status';
import { PageHeader, Card, Empty } from '@/components/ui';
import { ActionForm, Field, Grid, SelectField } from '@/components/forms';
import { campusOptions, countryOptions } from '@/lib/options';
import { updateOrganization, createCampus, createRoom, saveSetting, savePreferences, saveCardTheme } from './actions';
import { CardThemePicker } from '@/components/card-theme-picker';
import { parseCardTheme } from '@/lib/card-theme';

export const metadata = { title: 'Configuración' };
const KNOWN = [
  { key: 'certificates.block_if_overdue', label: 'Bloquear certificados con deuda vencida', example: 'true' },
  { key: 'conferences.min_attendance_pct', label: 'Asistencia mínima en conferencias (%)', example: '75' },
];

export default async function Page({ searchParams }: { searchParams: Promise<{ t?: string }> }) {
  const sp = await searchParams;
  const ctx = await getContext();
  const orgId = requireOrg(ctx);
  const owner = ctx.isOwner || ctx.isPlatformAdmin;
  const store = can(ctx, 'store.view') || can(ctx, 'store.create');
  const tabs = [
    { key: 'personal', label: '👤 Mi configuración', href: '/app/configuracion' },
    ...(ctx.teacherId || owner ? [{ key: 'docencia', label: '🧑‍🏫 Docencia', href: '/app/configuracion?t=docencia' }] : []),
    ...(store ? [{ key: 'caja', label: '🛒 Caja', href: '/app/configuracion?t=caja' }] : []),
    ...(can(ctx, 'finance.create') ? [{ key: 'finanzas', label: '💳 Finanzas', href: '/app/configuracion?t=finanzas' }] : []),
    ...(owner ? [{ key: 'institucion', label: '🏛 Todo el sistema (propietario)', href: '/app/configuracion?t=institucion' }] : []),
  ];
  const t = tabs.some((x) => x.key === sp.t) ? sp.t! : 'personal';
  const pr = prefsOf(ctx.profile);
  const chk = (name: string, label: string, val: boolean | undefined, hint?: string) => (
    <label className="flex items-start gap-2 text-sm"><input type="hidden" name={name} value="off" /><input type="checkbox" name={name} value="on" defaultChecked={!!val} className="mt-1" />
      <span>{label}{hint && <span className="block text-xs text-slate-500">{hint}</span>}</span></label>);
  const { data: cardSetting } = await ctx.supabase.from('organization_settings').select('value').eq('organization_id', orgId).eq('key', 'ui.cards').maybeSingle();
  const orgCards = parseCardTheme(cardSetting?.value);
  if (t !== 'institucion') {
    const nav = t === 'personal' ? await buildNav(ctx) : [];
    return (
      <>
        <PageHeader title="⚙ Configuración" subtitle="Cada persona configura lo suyo según su rol. La configuración de todo el sistema es solo del propietario." />
        <Tabs items={tabs} current={t} />
        <div className="max-w-2xl" data-testid={`config-${t}`}>
          {t === 'personal' && <Card title="👤 Mi configuración">
            <ActionForm action={savePreferences} submitLabel="Guardar" resetOnSuccess={false}><input type="hidden" name="part" value="personal" />
              <label className="block"><span className="label">🌐 Idioma de la plataforma (solo para usted)</span>
                <select name="locale" defaultValue={pr.locale ?? 'es'} className="input" data-testid="mi-idioma">{LOCALES.map(([c, n, f]) => <option key={c} value={c}>{f} {n}</option>)}</select>
                <span className="mt-1 block text-xs text-slate-500">El menú cambia al instante. Textos, documentos, chat y subtítulos de las clases se traducen en su navegador (Chrome o Edge), sin afectar a nadie más.</span></label>
              <label className="block"><span className="label">Página de inicio al entrar</span>
                <select name="home" defaultValue={pr.home ?? '/app'} className="input">{nav.map((i) => <option key={i.href} value={i.href}>{i.icon} {i.label}</option>)}</select></label>
              <label className="block"><span className="label">Tamaño de las listas</span>
                <select name="density" defaultValue={pr.density ?? 'normal'} className="input"><option value="normal">Normal</option><option value="compacta">Compacta (más filas en pantalla)</option></select></label>
              {chk('notices', 'Recibir avisos por correo (boletas, anuncios importantes)', pr.notices ?? true)}
              <p className="text-xs text-slate-500">♿ Letra grande, modo oscuro y contraste: botón ♿ arriba a la derecha de cada página. 🔑 Contraseña y verificación en dos pasos: <Link className="link" href="/app/perfil">Mi cuenta</Link>.</p>
            </ActionForm></Card>}
          {t === 'personal' && <Card title="🎨 Colores de mis tarjetas" className="mt-6 scroll-mt-6" id="tarjetas">
            <p className="mb-4 text-sm text-slate-600">Elija cómo se ven las tarjetas de cifras del panel. Solo cambia para usted.</p>
            <ActionForm action={saveCardTheme} submitLabel="Guardar colores" resetOnSuccess={false}><input type="hidden" name="scope" value="personal" />
              <CardThemePicker value={parseCardTheme((ctx.profile?.preferences as { cards?: unknown } | null)?.cards)} allowInherit inherited={orgCards ?? undefined} />
            </ActionForm></Card>}
          {t === 'docencia' && <Card title="🧑‍🏫 Mis clases virtuales">
            <ActionForm action={savePreferences} submitLabel="Guardar" resetOnSuccess={false}><input type="hidden" name="part" value="teaching" />
              {chk('waiting_room', 'Activar la sala de espera en mis clases nuevas', pr.teaching?.waiting_room, 'Usted admite a cada estudiante antes de entrar.')}
              {chk('students_share', 'Permitir que los estudiantes compartan pantalla en mis clases nuevas', pr.teaching?.students_share)}
            </ActionForm></Card>}
          {t === 'caja' && <Card title="🛒 Mi caja (SEMATEC VENTA)">
            <ActionForm action={savePreferences} submitLabel="Guardar" resetOnSuccess={false}><input type="hidden" name="part" value="pos" />
              <label className="block"><span className="label">Medio de pago que aparece marcado</span>
                <select name="method" defaultValue={pr.pos?.method ?? 'cash'} className="input">{SALE_METHODS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
              {chk('auto_print', 'Abrir la boleta para imprimir apenas termino una venta', pr.pos?.auto_print)}
            </ActionForm></Card>}
          {t === 'finanzas' && <Card title="💳 Mis cobros">
            <ActionForm action={savePreferences} submitLabel="Guardar" resetOnSuccess={false}><input type="hidden" name="part" value="finance" />
              {chk('send_receipt', 'Al registrar un pago, enviar la boleta al correo del estudiante', pr.finance?.send_receipt ?? true)}
            </ActionForm></Card>}
        </div>
      </>
    );
  }
  const sb = ctx.supabase;
  const [{ data: org }, { data: campuses }, { data: rooms }, { data: settings }, countries, campusOpts] = await Promise.all([
    sb.from('organizations').select('*').eq('id', orgId).single(),
    sb.from('campuses').select('*').eq('organization_id', orgId).order('name'),
    sb.from('rooms').select('*, campuses(name)').eq('organization_id', orgId).order('code'),
    sb.from('organization_settings').select('*').eq('organization_id', orgId).order('key'),
    countryOptions(ctx), campusOptions(ctx),
  ]);
  const orgAdmin = owner;
  return (
    <>
      <PageHeader title="⚙ Configuración" subtitle="Cada persona configura lo suyo según su rol. La configuración de todo el sistema es solo del propietario." />
      <Tabs items={tabs} current={t} />
      <MailStatus />
      {ctx.isOwner && <Card title="📦 Sus datos y su enlace" className="mb-6">
        <p className="text-sm text-slate-600">Enlace propio de {org.display_name}: <a className="link" href={`/o/${org.slug}`} target="_blank" rel="noreferrer" data-testid="enlace-propio">/o/{org.slug}</a> — compártalo con sus miembros para entrar directo a su plataforma.</p>
        <p className="mt-2 text-sm text-slate-600">Descargue una copia de todos los datos de su organización (usuarios, salas, clases, asistencia, grabaciones, anuncios, archivos y más) en un archivo JSON.</p>
        <a className="btn-secondary mt-3 inline-block" href="/app/configuracion/exportar" data-testid="exportar-datos">⬇ Exportar todos los datos</a>
      </Card>}
      <Card title="🎨 Colores de las tarjetas (toda la institución)" className="mb-6 scroll-mt-6" id="tarjetas-institucion">
        <p className="mb-4 text-sm text-slate-600">Estilo y color por defecto de las tarjetas de cifras para todos los usuarios. Cada persona puede cambiar el suyo en «Mi configuración».</p>
        <ActionForm action={saveCardTheme} submitLabel="Guardar para toda la institución" resetOnSuccess={false}><input type="hidden" name="scope" value="institucion" />
          <CardThemePicker value={orgCards} />
        </ActionForm>
      </Card>
      <div className="grid gap-6 xl:grid-cols-2">
        {orgAdmin && (
          <Card title="Datos de la institución">
            <ActionForm action={updateOrganization} submitLabel="Guardar" resetOnSuccess={false}>
              <Grid>
                <Field label="Razón social" name="legal_name" required defaultValue={org.legal_name} />
                <Field label="Nombre visible" name="display_name" required defaultValue={org.display_name} />
                <Field label="Identificador tributario" name="tax_id" defaultValue={org.tax_id} />
                <Field label="Zona horaria" name="timezone" required defaultValue={org.timezone} />
                <Field label="Idioma" name="default_locale" required defaultValue={org.default_locale} />
                <Field label="Moneda base" name="base_currency_ro" defaultValue={org.base_currency} />
              </Grid>
            </ActionForm>
          </Card>
        )}
        {owner && (
          <Card title="Reglas configurables">
            {settings?.length ? <table className="table mb-4"><thead><tr><th>Parámetro</th><th>Valor</th></tr></thead>
              <tbody>{settings.map((s: any) => <tr key={s.id}><td><code className="text-xs">{s.key}</code><br /><span className="text-xs text-slate-500">{s.description}</span></td><td className="font-mono text-xs">{JSON.stringify(s.value)}</td></tr>)}</tbody></table> : <Empty>Sin parámetros personalizados.</Empty>}
            <ActionForm action={saveSetting} submitLabel="Guardar parámetro">
              <Grid>
                <SelectField label="Parámetro" name="key" required options={KNOWN.map((k) => ({ value: k.key, label: k.label }))} />
                <Field label="Valor (JSON)" name="value" required placeholder="true / 75 / &quot;texto&quot;" />
              </Grid>
            </ActionForm>
          </Card>
        )}
        {orgAdmin && (
          <Card title="Sedes">
            {campuses?.length ? <ul className="mb-4 divide-y divide-slate-100 text-sm">{campuses.map((c: any) => <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 py-2"><span><b>{c.code}</b> · {c.name} · {c.city ?? ''} ({c.timezone})</span>
              {ctx.isOwner && <OwnerActions table="campuses" id={c.id} active={c.status === 'active'} path="/app/configuracion" name={`la sede ${c.name}`} />}</li>)}</ul> : <Empty>Sin sedes.</Empty>}
            <ActionForm action={createCampus} submitLabel="Crear sede">
              <Grid cols={3}>
                <Field label="Código" name="code" required /><Field label="Nombre" name="name" required className="md:col-span-2" />
                <SelectField label="País" name="country_code" required options={countries} defaultValue={org.country_code} />
                <Field label="Ciudad" name="city" /><Field label="Zona horaria" name="timezone" required defaultValue={org.timezone} />
                <Field label="Dirección" name="address" className="md:col-span-3" />
              </Grid>
            </ActionForm>
          </Card>
        )}
        {orgAdmin && (
          <Card title="Salas y laboratorios">
            {rooms?.length ? <ul className="mb-4 divide-y divide-slate-100 text-sm">{rooms.map((r: any) => <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 py-2"><span><b>{r.code}</b> · {r.name} · {r.campuses?.name} · capacidad {r.capacity}</span>
              {ctx.isOwner && <OwnerActions table="rooms" id={r.id} active={r.status === 'active'} path="/app/configuracion" name={`la sala ${r.name}`} />}</li>)}</ul> : <Empty>Sin salas.</Empty>}
            {campusOpts.length > 0 && (
              <ActionForm action={createRoom} submitLabel="Crear sala">
                <Grid cols={3}>
                  <SelectField label="Sede" name="campus_id" required options={campusOpts} />
                  <Field label="Código" name="code" required /><Field label="Nombre" name="name" required />
                  <Field label="Capacidad" name="capacity" type="number" min={1} required />
                  <SelectField label="Tipo" name="room_type" required defaultValue="classroom" options={[{ value: 'classroom', label: 'Sala de clases' }, { value: 'lab', label: 'Laboratorio' }, { value: 'auditorium', label: 'Auditorio' }]} />
                </Grid>
              </ActionForm>
            )}
          </Card>
        )}
      </div>
    </>
  );
}
