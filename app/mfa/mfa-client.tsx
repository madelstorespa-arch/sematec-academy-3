'use client';
import { useEffect, useState } from 'react';
import { createBrowser } from '@/lib/supabase/browser';

type Enroll = { factorId: string; qr: string; secret: string };

export function MfaClient() {
  const supabase = createBrowser();
  const [factorId, setFactorId] = useState<string | null>(null);
  const [enroll, setEnroll] = useState<Enroll | null>(null);
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    (async () => {
      const { data, error } = await supabase.auth.mfa.listFactors();
      if (error) return setError('No se pudo consultar el estado de MFA. Revise su conexión.');
      const verified = data.totp.find((f) => f.status === 'verified');
      if (verified) return setFactorId(verified.id);
      // Limpia inscripciones incompletas y crea una nueva
      for (const f of data.all.filter((f) => f.status !== 'verified')) await supabase.auth.mfa.unenroll({ factorId: f.id });
      const r = await supabase.auth.mfa.enroll({ factorType: 'totp', friendlyName: `SEMATEC ACADEMY ${new Date().toISOString().slice(0, 10)}` });
      if (r.error) return setError(r.error.message);
      setEnroll({ factorId: r.data.id, qr: r.data.totp.qr_code, secret: r.data.totp.secret });
      setFactorId(r.data.id);
    })();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function verify(e: React.FormEvent) {
    e.preventDefault();
    if (!factorId) return;
    setBusy(true); setError(null);
    try {
      const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId, code: code.trim() });
      if (error) { setError('Código incorrecto o vencido. Intente con el código actual.'); return; }
      const nx = new URLSearchParams(window.location.search).get('next') ?? '/app';
      window.location.href = /^\/(?![/\\])[^\s\\]*$/.test(nx) && !nx.includes('://') ? nx : '/app';
    } catch {
      setError('Sin conexión: no se pudo verificar el código. Reintente.');
    } finally { setBusy(false); }
  }

  return (
    <div className="space-y-5">
      {enroll && (
        <div className="card card-pad text-center">
          <p className="text-sm text-slate-600">1. Escanee este código con su app de autenticación.</p>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={enroll.qr} alt="Código QR para configurar MFA" className="mx-auto my-3 h-44 w-44" />
          <p className="text-xs text-slate-500">¿No puede escanear? Clave: <code className="break-all font-mono">{enroll.secret}</code></p>
        </div>
      )}
      <form onSubmit={verify} className="space-y-4">
        <label className="block">
          <span className="label">{enroll ? '2. ' : ''}Código de 6 dígitos</span>
          <input className="input text-center font-mono text-lg tracking-[0.5em]" inputMode="numeric" pattern="[0-9]{6}" maxLength={6}
            value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} required autoFocus />
        </label>
        <button className="btn-primary w-full" disabled={busy || !factorId || code.length !== 6}>{busy ? 'Verificando…' : 'Verificar'}</button>
      </form>
      {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      <form action="/auth/salir" method="post" className="text-center">
        <button className="text-sm text-slate-500 hover:underline">Cerrar sesión</button>
      </form>
    </div>
  );
}
