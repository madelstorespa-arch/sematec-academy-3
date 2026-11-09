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
