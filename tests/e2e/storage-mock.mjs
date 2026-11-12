// Simulador mínimo de Supabase Storage para pruebas locales (subida y descarga con enlaces firmados)
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
const ROOT = '/tmp/storage';
const tokens = new Map();
const send = (res, code, obj) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)); };
const body = (req) => new Promise((r) => { const c = []; req.on('data', (d) => c.push(d)); req.on('end', () => r(Buffer.concat(c))); });
function filePart(buf, ct) {
  const m = /boundary=(.+)$/.exec(ct || '');
  if (!m) return buf;
  const b = Buffer.from('--' + m[1]);
  let best = Buffer.alloc(0);
  let i = buf.indexOf(b);
  while (i !== -1) {
    const j = buf.indexOf(b, i + b.length); if (j === -1) break;
    const part = buf.subarray(i + b.length + 2, j - 2); const h = part.indexOf('\r\n\r\n');
    const content = part.subarray(h + 4); if (content.length > best.length) best = content;
    i = j;
  }
  return best;
}
http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x');
  const p = decodeURIComponent(u.pathname);
  let m;
  if (req.method === 'POST' && (m = p.match(/^\/object\/upload\/sign\/(.+)$/))) {
    const t = crypto.randomUUID(); tokens.set(t, m[1]);
    return send(res, 200, { url: `/object/upload/sign/${m[1]}?token=${t}` });
  }
  if (req.method === 'PUT' && (m = p.match(/^\/object\/upload\/sign\/(.+)$/))) {
    if (tokens.get(u.searchParams.get('token')) !== m[1]) return send(res, 400, { error: 'invalid token' });
    const data = filePart(await body(req), req.headers['content-type']);
    const f = path.join(ROOT, m[1]); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, data);
    return send(res, 200, { Key: m[1] });
  }
  if (req.method === 'POST' && (m = p.match(/^\/object\/sign\/(.+)$/))) {
    if (!fs.existsSync(path.join(ROOT, m[1]))) return send(res, 404, { statusCode: '404', error: 'not_found', message: 'Object not found' });
    const t = crypto.randomUUID(); tokens.set(t, m[1]);
    return send(res, 200, { signedURL: `/object/sign/${m[1]}?token=${t}` });
  }
  if (req.method === 'GET' && (m = p.match(/^\/object\/sign\/(.+)$/))) {
    if (tokens.get(u.searchParams.get('token')) !== m[1]) return send(res, 400, { error: 'invalid token' });
    const f = path.join(ROOT, m[1]);
    const h = { 'content-type': 'video/webm' };
    if (u.searchParams.has('download')) h['content-disposition'] = `attachment; filename="${u.searchParams.get('download') || path.basename(f)}"`;
    res.writeHead(200, h); return fs.createReadStream(f).pipe(res);
  }
  if (req.method === 'DELETE' && (m = p.match(/^\/object\/([^/]+)$/))) {
    const { prefixes } = JSON.parse((await body(req)).toString() || '{}');
    for (const x of prefixes ?? []) fs.rmSync(path.join(ROOT, m[1], x), { force: true });
    return send(res, 200, (prefixes ?? []).map((name) => ({ name })));
  }
  // Listar, copiar, subir y descargar con la clave de servicio (Oficina / ONLYOFFICE)
  if (req.method === 'POST' && (m = p.match(/^\/object\/list\/([^/]+)$/))) {
    const { prefix = '', search = '', limit = 100 } = JSON.parse((await body(req)).toString() || '{}');
    const dir = path.join(ROOT, m[1], prefix);
    const names = fs.existsSync(dir) ? fs.readdirSync(dir).filter((n) => !search || n.includes(search)).slice(0, limit) : [];
    return send(res, 200, names.map((name) => ({ name, id: name, metadata: { size: fs.statSync(path.join(dir, name)).size } })));
  }
  if (req.method === 'POST' && p === '/object/copy') {
    const { bucketId, sourceKey, destinationKey } = JSON.parse((await body(req)).toString() || '{}');
    const src = path.join(ROOT, bucketId, sourceKey); const dst = path.join(ROOT, bucketId, destinationKey);
    if (!fs.existsSync(src)) return send(res, 404, { statusCode: '404', error: 'not_found', message: 'Object not found' });
    fs.mkdirSync(path.dirname(dst), { recursive: true }); fs.copyFileSync(src, dst);
    return send(res, 200, { Key: `${bucketId}/${destinationKey}` });
  }
  if (req.method === 'POST' && (m = p.match(/^\/object\/(?!sign\/|upload\/|list\/)(.+)$/))) {
    const data = filePart(await body(req), req.headers['content-type']);
    const f = path.join(ROOT, m[1]); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, data);
    return send(res, 200, { Key: m[1] });
  }
  if (req.method === 'GET' && (m = p.match(/^\/object\/(?:authenticated\/)?(?!sign\/|upload\/|list\/)(.+)$/))) {
    const f = path.join(ROOT, m[1]);
    if (!fs.existsSync(f)) return send(res, 404, { statusCode: '404', error: 'not_found', message: 'Object not found' });
    res.writeHead(200, { 'content-type': 'application/octet-stream' }); return fs.createReadStream(f).pipe(res);
  }
  send(res, 404, { error: 'no route ' + req.method + ' ' + p });
}).listen(5001, () => console.log('storage mock 5001'));
