// Servidor SMTP mínimo para pruebas: guarda cada correo en /tmp/mails/<n>.eml
import net from 'node:net';
import fs from 'node:fs';
const DIR = '/tmp/mails'; fs.mkdirSync(DIR, { recursive: true });
let n = 0;
net.createServer((s) => {
  let data = false; let buf = ''; let rcpt = [];
  const w = (x) => s.write(x + '\r\n');
  w('220 mock ESMTP');
  s.on('data', (chunk) => {
    buf += chunk.toString('utf8');
    let i;
    while ((i = buf.indexOf('\r\n')) !== -1 || (data && buf.includes('\r\n.\r\n'))) {
      if (data) {
        const end = buf.indexOf('\r\n.\r\n'); if (end === -1) return;
        const msg = buf.slice(0, end); buf = buf.slice(end + 5); data = false;
        fs.writeFileSync(`${DIR}/${Date.now()}-${++n}.eml`, `X-To: ${rcpt.join(',')}\r\n${msg}`);
        rcpt = []; w('250 OK queued'); continue;
      }
      const line = buf.slice(0, i); buf = buf.slice(i + 2);
      const cmd = line.slice(0, 4).toUpperCase();
      if (cmd === 'EHLO' || cmd === 'HELO') { w('250-mock'); w('250 8BITMIME'); }
      else if (cmd === 'MAIL') w('250 OK');
      else if (cmd === 'RCPT') { rcpt.push(line.replace(/^RCPT TO:\s*/i, '').replace(/[<>]/g, '')); w('250 OK'); }
      else if (cmd === 'DATA') { data = true; w('354 End data with <CR><LF>.<CR><LF>'); }
      else if (cmd === 'QUIT') { w('221 Bye'); s.end(); }
      else if (cmd === 'RSET' || cmd === 'NOOP') w('250 OK');
      else w('250 OK');
    }
  });
  s.on('error', () => {});
}).listen(2525, '127.0.0.1', () => console.log('smtp mock 2525'));
