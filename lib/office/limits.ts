/** Espacio por persona (documentos de la Oficina + Mis archivos). Se alerta al 80 %. */
export const OFFICE_QUOTA_BYTES = Number(process.env.NEXT_PUBLIC_OFFICE_QUOTA_MB ?? 2048) * 1024 * 1024;
/** Días que un documento permanece en la papelera antes de eliminarse definitivamente. */
export const TRASH_DAYS = Number(process.env.NEXT_PUBLIC_OFFICE_TRASH_DAYS ?? 30);
