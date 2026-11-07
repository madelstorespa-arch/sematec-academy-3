'use client';
import { useEffect } from 'react';

/** Registra el service worker (app instalable y uso sin conexión). */
export function RegisterSW() {
  useEffect(() => {
    if (process.env.NODE_ENV !== 'production' || !('serviceWorker' in navigator)) return;
    navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => { /* navegador sin soporte o modo privado */ });
  }, []);
  return null;
}
