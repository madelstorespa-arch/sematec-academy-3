'use client';
export function PrintButton() {
  return <button className="btn-primary" onClick={() => window.print()}>Imprimir / Guardar PDF</button>;
}
