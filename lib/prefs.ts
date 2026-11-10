/** Preferencias personales: cada usuario configura lo suyo sin afectar a los demás ni al sistema. */
export type Prefs = {
  locale?: string; home?: string; notices?: boolean; density?: 'normal' | 'compacta';
  teaching?: { waiting_room?: boolean; students_share?: boolean };
  pos?: { method?: string; auto_print?: boolean };
  finance?: { send_receipt?: boolean };
};
export const prefsOf = (profile: { preferences?: unknown } | null | undefined): Prefs => {
  const p = profile?.preferences;
  return p && typeof p === 'object' && !Array.isArray(p) ? (p as Prefs) : {};
};
