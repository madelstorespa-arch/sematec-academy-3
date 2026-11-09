/** Documentos de identidad: tipos, validación del RUT chileno (módulo 11) y formato. */
export const DOC_TYPES: [string, string][] = [
  ['RUN', 'RUT / RUN (Chile)'], ['PASAPORTE', 'Pasaporte'], ['DNI', 'DNI'], ['CEDULA_EXT', 'Cédula de identidad extranjera'], ['OTRO', 'Otro documento'],
];
export const docLabel = (t?: string | null) => DOC_TYPES.find(([k]) => k === t)?.[1] ?? t ?? '';

/** Valida el dígito verificador de un RUT («12.345.678-5», «12345678-5» o «123456785»). */
export function validRut(raw: string): boolean {
  const s = raw.replace(/[.\s-]/g, '').toUpperCase();
  if (!/^\d{7,8}[0-9K]$/.test(s)) return false;
  const body = s.slice(0, -1); const dv = s.slice(-1);
  let sum = 0; let mul = 2;
  for (let i = body.length - 1; i >= 0; i--) { sum += Number(body[i]) * mul; mul = mul === 7 ? 2 : mul + 1; }
  const r = 11 - (sum % 11);
  return dv === (r === 11 ? '0' : r === 10 ? 'K' : String(r));
}

/** «123456785» → «12.345.678-5» */
export function formatRut(raw: string): string {
  const s = raw.replace(/[.\s-]/g, '').toUpperCase();
  const body = s.slice(0, -1).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${body}-${s.slice(-1)}`;
}

/** Revisa tipo y número; devuelve el número normalizado o un mensaje claro. */
export function checkDocument(type: string | null, number: string | null, required = false):
  { ok: true; type: string | null; number: string | null } | { ok: false; error: string } {
  const t = (type ?? '').trim(); const n = (number ?? '').trim();
  if (!n) return required ? { ok: false, error: 'Ingrese el número de documento de identidad (RUT, pasaporte u otro).' } : { ok: true, type: null, number: null };
  if (!t) return { ok: false, error: 'Elija el tipo de documento (RUT, pasaporte u otro).' };
  if (!DOC_TYPES.some(([k]) => k === t)) return { ok: false, error: 'Tipo de documento inválido.' };
  if (t === 'RUN') {
    if (!validRut(n)) return { ok: false, error: `El RUT «${n}» no es válido (revise el dígito verificador).` };
    return { ok: true, type: t, number: formatRut(n) };
  }
  const clean = n.toUpperCase().replace(/\s+/g, '');
  if (!/^[A-Z0-9.\-]{4,20}$/.test(clean)) return { ok: false, error: 'El número de documento debe tener entre 4 y 20 letras o números.' };
  return { ok: true, type: t, number: clean };
}
