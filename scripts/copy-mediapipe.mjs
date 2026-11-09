// Copia los archivos WebAssembly de MediaPipe (fondos virtuales) a /public para servirlos
// desde el propio dominio (sin depender de CDNs externos; compatible con la CSP).
import fs from 'node:fs';
import path from 'node:path';
const src = path.join('node_modules', '@mediapipe', 'tasks-vision', 'wasm');
const dst = path.join('public', 'mediapipe', 'wasm');
if (!fs.existsSync(src)) { console.warn('[mediapipe] no instalado; fondos virtuales no disponibles'); process.exit(0); }
fs.mkdirSync(dst, { recursive: true });
for (const f of fs.readdirSync(src)) fs.copyFileSync(path.join(src, f), path.join(dst, f));
console.log('[mediapipe] copiado a public/mediapipe/wasm');

// FFmpeg (WebAssembly) para cortar y unir grabaciones en el navegador, servido desde el propio dominio
for (const kind of ['esm']) {
  const fsrc = path.join('node_modules', '@ffmpeg', 'core', 'dist', kind);
  const fdst = path.join('public', 'ffmpeg', kind);
  if (!fs.existsSync(fsrc)) { console.warn('[ffmpeg] no instalado; cortar videos no disponible'); break; }
  fs.mkdirSync(fdst, { recursive: true });
  for (const f of fs.readdirSync(fsrc)) fs.copyFileSync(path.join(fsrc, f), path.join(fdst, f));
}
console.log('[ffmpeg] copiado a public/ffmpeg');
// Trabajador de FFmpeg servido tal cual (sin pasar por el empaquetador, que rompe la carga del núcleo)
{
  const wsrc = path.join('node_modules', '@ffmpeg', 'ffmpeg', 'dist', 'esm');
  const wdst = path.join('public', 'ffmpeg', 'worker');
  if (fs.existsSync(wsrc)) {
    fs.mkdirSync(wdst, { recursive: true });
    for (const f of fs.readdirSync(wsrc)) if (f.endsWith('.js')) fs.copyFileSync(path.join(wsrc, f), path.join(wdst, f));
  }
}
