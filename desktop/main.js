// SEMATEC Aula para computador: abre la plataforma en su propia ventana, con cámara, micrófono
// y compartir pantalla (eligiendo qué pantalla o ventana mostrar en la clase).
const { app, BrowserWindow, shell, session, desktopCapturer, dialog } = require('electron');

const SITE = (process.env.SEMATEC_SITE || 'https://sematec-academy-3.vercel.app').replace(/\/$/, '');
const ORIGIN = new URL(SITE).origin;
const own = (url) => { try { return new URL(url).origin === ORIGIN; } catch { return false; } };

if (!app.requestSingleInstanceLock()) { app.quit(); process.exit(0); }
let win = null;

function createWindow() {
  win = new BrowserWindow({
    width: 1280, height: 820, minWidth: 380, minHeight: 520,
    title: 'SEMATEC Aula', backgroundColor: '#0b1736', autoHideMenuBar: true,
    webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false, spellcheck: true },
  });
  win.webContents.setUserAgent(`${win.webContents.getUserAgent()} SematecAulaDesktop/${app.getVersion()}`);
  win.loadURL(`${SITE}/app`);
  // Enlaces externos (YouTube, Drive, WhatsApp…) se abren en el navegador
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (own(url)) return { action: 'allow' };
    if (/^https?:\/\//.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (!own(url)) { e.preventDefault(); if (/^https?:\/\//.test(url)) shell.openExternal(url); }
  });
  win.webContents.on('did-fail-load', (_e, code, desc, url, isMain) => {
    if (isMain && code !== -3) {
      win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(
        `<body style="font-family:sans-serif;text-align:center;padding:60px;background:#0b1736;color:#fff">
         <h2>Sin conexión</h2><p>No se pudo abrir ${SITE}.</p>
         <p><a style="color:#9db4ff" href="${SITE}/app">Reintentar</a></p></body>`));
    }
  });
}

app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });

app.whenReady().then(() => {
  const ses = session.defaultSession;
  // Solo la plataforma puede pedir cámara, micrófono, pantalla y notificaciones
  const allowed = new Set(['media', 'display-capture', 'notifications', 'clipboard-sanitized-write', 'fullscreen']);
  ses.setPermissionRequestHandler((wc, perm, cb, details) => cb(allowed.has(perm) && own(details.requestingUrl || wc.getURL())));
  ses.setPermissionCheckHandler((_wc, perm, origin) => allowed.has(perm) && own(origin));

  // Compartir pantalla: la persona elige qué pantalla o ventana mostrar
  ses.setDisplayMediaRequestHandler(async (request, callback) => {
    try {
      if (!own(request.securityOrigin || request.frame?.url || '')) return callback({});
      const sources = await desktopCapturer.getSources({ types: ['screen', 'window'] });
      const list = sources.filter((s) => !/SEMATEC Aula/.test(s.name)).slice(0, 9);
      if (!list.length) return callback({});
      const names = list.map((s, i) => (s.id.startsWith('screen') ? `🖥 Pantalla ${i + 1}` : `🪟 ${s.name.slice(0, 40)}`));
      const { response } = await dialog.showMessageBox(win, {
        type: 'question', title: 'Compartir pantalla', message: '¿Qué quiere mostrar en la clase?',
        buttons: [...names, 'Cancelar'], cancelId: names.length, noLink: true,
      });
      if (response >= list.length) return callback({});
      callback({ video: list[response], audio: process.platform === 'win32' ? 'loopback' : undefined });
    } catch {
      callback({});
    }
  }, { useSystemPicker: true });

  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
