'use client';
import { updateNow } from '@/components/version-watcher';

export function ReloadButton() {
  return <button type="button" className="btn-secondary" onClick={() => updateNow()}>🔄 Recargar la app en este equipo</button>;
}
