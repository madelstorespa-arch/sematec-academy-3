#!/usr/bin/env python3
"""SEMATEC Academy 3.0, demostración local con biblioteca estándar Python."""
import os, sqlite3, secrets, hashlib, hmac, html, urllib.parse, json, re, time, mimetypes, io, email.parser, email.policy
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler
from http.cookies import SimpleCookie
from pathlib import Path

ROOT=Path(__file__).resolve().parent
DB=ROOT/'sematec.sqlite3'
PORT=int(os.environ.get('PORT','8080'))
SESS={}
STATES=['Iniciada','Enviada','En revisión','Observada','Aprobada','Rechazada']
PAYSTATES=['Pendiente','En verificación','Pagado','Rechazado','Anulado','Reembolsado']
def db():
 c=sqlite3.connect(DB); c.row_factory=sqlite3.Row; c.execute('PRAGMA foreign_keys=ON'); return c
def pw(p,s=None):
 s=s or secrets.token_hex(16)
 return s+'$'+hashlib.pbkdf2_hmac('sha256',p.encode(),bytes.fromhex(s),230000).hex()
def verify(p,h):
 try:
  s,v=h.split('$'); return hmac.compare_digest(pw(p,s).split('$')[1],v)
 except: return False
def esc(s):return html.escape(str(s if s is not None else ''),quote=True)
def init():
 with db() as c:
  c.executescript('''CREATE TABLE IF NOT EXISTS settings(k TEXT PRIMARY KEY,v TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS users(id INTEGER PRIMARY KEY,name TEXT NOT NULL,email TEXT UNIQUE NOT NULL,password TEXT NOT NULL,role TEXT NOT NULL,active INTEGER NOT NULL DEFAULT 1);
  CREATE TABLE IF NOT EXISTS courses(id INTEGER PRIMARY KEY,title TEXT NOT NULL,mode TEXT NOT NULL,price INTEGER NOT NULL CHECK(price>=0),seats INTEGER NOT NULL CHECK(seats>=0),active INTEGER NOT NULL DEFAULT 1);
  CREATE TABLE IF NOT EXISTS applications(id INTEGER PRIMARY KEY,name TEXT NOT NULL,email TEXT NOT NULL,document TEXT NOT NULL,course_id INTEGER NOT NULL REFERENCES courses(id),status TEXT NOT NULL DEFAULT 'Enviada',created TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
  CREATE TABLE IF NOT EXISTS enrollments(id INTEGER PRIMARY KEY,application_id INTEGER UNIQUE NOT NULL REFERENCES applications(id),status TEXT NOT NULL DEFAULT 'Pendiente de pago',created TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
  CREATE TABLE IF NOT EXISTS payments(id INTEGER PRIMARY KEY,enrollment_id INTEGER NOT NULL REFERENCES enrollments(id),amount INTEGER NOT NULL CHECK(amount>=0),method TEXT NOT NULL,reference TEXT NOT NULL DEFAULT '',status TEXT NOT NULL DEFAULT 'Pendiente',created TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
  CREATE TABLE IF NOT EXISTS contacts(id INTEGER PRIMARY KEY,name TEXT NOT NULL,email TEXT NOT NULL,message TEXT NOT NULL,created TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
  CREATE TABLE IF NOT EXISTS audit(id INTEGER PRIMARY KEY,user TEXT NOT NULL,event TEXT NOT NULL,created TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);''')
  for k,v in [('name','INSTITUTO SEMATEC'),('whatsapp',''),('contact_email',''),('bank',''),('logo','')]:c.execute('INSERT OR IGNORE INTO settings VALUES(?,?)',(k,v))
  if not c.execute('SELECT 1 FROM courses').fetchone():
   c.executemany('INSERT INTO courses(title,mode,price,seats) VALUES(?,?,?,?)',[('Informática básica','Presencial',50000,25),('Microsoft Word','Híbrido',80000,20),('Excel inicial','Online',75000,30)])
  if not c.execute('SELECT 1 FROM users').fetchone():
   password=secrets.token_urlsafe(12); c.execute('INSERT INTO users(name,email,password,role) VALUES(?,?,?,?)',('Administrador','admin@sematec.local',pw(password),'admin'))
   print('\n'+'='*65+'\nSEMATEC - ACCESO INICIAL (GUÁRDALO EN UN LUGAR SEGURO)\nUsuario: admin@sematec.local\nContraseña: '+password+'\n'+'='*65+'\n',flush=True)
def layout(title,content,user=None,notice='',status=200):
 with db() as c: settings={r['k']:r['v'] for r in c.execute('SELECT * FROM settings')}
 name=esc(settings['name']); logo=('<img class="logo" src="/logo">' if settings['logo'] else '<span class="brandmark">S</span>')
 nav='<a href="/">Inicio</a><a href="/cursos">Cursos</a><a href="/postular">Postular</a><a href="/contacto">Contacto</a>'
 if user:
  nav+='<a href="/panel">Panel</a><a href="/matriculas">Matrículas</a>'
  if user['role'] in ('admin','finanzas'):nav+='<a href="/pagos">Pagos</a>'
  if user['role']=='admin':nav+='<a href="/admin">Administración</a><a href="/usuarios">Usuarios</a><a href="/configuracion">Configuración</a>'
  nav+='<form class="inline" method="post" action="/salir"><input type="hidden" name="csrf" value="'+esc(user['csrf'])+'"><button class="small">Salir</button></form>'
 else:nav+='<a href="/ingresar">Ingresar</a>'
 alert='<div class="alert">'+esc(notice)+'</div>' if notice else ''
 css='''*{box-sizing:border-box}body{margin:0;font:16px system-ui,Arial;background:#f4f7fb;color:#213044}header{background:#0c2949;color:white;padding:15px max(18px,5vw);display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap}.brand{display:flex;align-items:center;gap:10px;font-weight:800}.brandmark{display:grid;place-items:center;background:#24a3c6;width:42px;height:42px;border-radius:12px;font-size:24px}.logo{width:45px;height:45px;object-fit:contain;background:white;border-radius:8px}nav{display:flex;flex-wrap:wrap;align-items:center;gap:7px}nav a{color:#e9f5ff;padding:8px 10px;text-decoration:none;border-radius:8px}nav a:hover{background:#235173}main{max-width:1160px;margin:26px auto;padding:0 16px}h1{font-size:clamp(25px,4vw,36px)}h2{font-size:21px}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(245px,1fr));gap:16px}.card,.panel{background:white;border:1px solid #e1e8f0;border-radius:14px;padding:20px;box-shadow:0 3px 12px #142b4509}.card h2{margin-top:0}a.btn,button{display:inline-block;border:0;border-radius:9px;padding:11px 17px;background:#087ca8;color:white;text-decoration:none;cursor:pointer;font-weight:650}button.small{padding:8px 10px;background:#276281}input,select,textarea{width:100%;padding:11px;border:1px solid #bdc9d7;border-radius:8px;margin:5px 0 14px;font:inherit}label{font-weight:650;display:block}.inline{display:inline}.inline select,.inline input{width:auto;margin:2px;padding:7px}.inline button{padding:8px}table{width:100%;border-collapse:collapse;background:white;border-radius:12px;overflow:hidden}th,td{text-align:left;padding:12px 9px;border-bottom:1px solid #e9edf3;vertical-align:top}th{background:#eaf2f9}.scroll{overflow:auto}.muted{color:#526579}.alert{background:#fef2cb;padding:15px;border-radius:9px;margin-bottom:18px}.hero{background:linear-gradient(120deg,#0b365f,#077ba1);color:white;padding:34px;border-radius:18px;margin-bottom:20px}.hero p{max-width:640px}.pill{display:inline-block;background:#ecf6fb;color:#075b80;border-radius:20px;padding:5px 9px;font-size:13px}footer{text-align:center;padding:40px;color:#667b90}@media(max-width:700px){header{display:block}nav{margin-top:12px}nav a{padding:7px}th,td{font-size:13px;padding:8px}main{margin:16px auto}}'''
 return f'''<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>{esc(title)} | {name}</title><style>{css}</style></head><body><header><div class="brand">{logo}<span>{name}</span></div><nav>{nav}</nav></header><main>{alert}{content}</main><footer>SEMATEC ACADEMY 3.0 · Demostración local, no apta para producción ni pagos reales</footer></body></html>'''.encode()
def audit(c,u,msg):c.execute('INSERT INTO audit(user,event) VALUES(?,?)',(u,msg))
def field(label,name,typ='text',required=True,value=''):
 return f'<label>{esc(label)}<input type="{typ}" name="{esc(name)}" value="{esc(value)}" {"required" if required else ""}></label>'
def select(label,name,options):return f'<label>{esc(label)}<select name="{esc(name)}">'+''.join(f'<option value="{esc(v)}">{esc(t)}</option>' for v,t in options)+'</select></label>'
def token(user):return '<input type="hidden" name="csrf" value="'+esc(user['csrf'])+'">' if user else ''
class Handler(BaseHTTPRequestHandler):
 def getuser(self):
  cookie=SimpleCookie();
  try:cookie.load(self.headers.get('Cookie',''))
  except:pass
  sid=cookie.get('sid'); sid=sid.value if sid else ''
  u=SESS.get(sid)
  if u and u['expiry']>time.time():return u
  SESS.pop(sid,None);return None
 def send(self,title,content,u=None,msg='',status=200,cookie=None):
  data=layout(title,content,u,msg,status);self.send_response(status);self.send_header('Content-Type','text/html; charset=utf-8');self.send_header('Content-Length',str(len(data)));self.send_header('Cache-Control','no-store');self.send_header('X-Content-Type-Options','nosniff');self.send_header('X-Frame-Options','DENY');
  if cookie:self.send_header('Set-Cookie',cookie)
  self.end_headers();self.wfile.write(data)
 def redirect(self,path,cookie=None):
  self.send_response(303);self.send_header('Location',path)
  if cookie:self.send_header('Set-Cookie',cookie)
  self.end_headers()
 def form(self):
  n=int(self.headers.get('Content-Length','0'))
  if n<0 or n>2_000_000:raise ValueError('Solicitud demasiado grande')
  body=self.rfile.read(n)
  if self.headers.get('Content-Type','').startswith('multipart/form-data'):
   raw=b'Content-Type: '+self.headers['Content-Type'].encode()+b'\r\nMIME-Version: 1.0\r\n\r\n'+body
   msg=email.parser.BytesParser(policy=email.policy.default).parsebytes(raw)
   result={}
   for part in msg.iter_parts():
    name=part.get_param('name',header='content-disposition')
    if name: result[name]=part.get_payload(decode=True) if part.get_filename() else part.get_content().strip()
   return result
  return {k:v[0].strip() for k,v in urllib.parse.parse_qs(body.decode('utf8'),keep_blank_values=True).items()}
 def require(self,roles=None):
  u=self.getuser()
  if not u or (roles and u['role'] not in roles):raise PermissionError('No tienes permisos para realizar esta operación.')
  return u
 def do_GET(self):
  try:self.handle_get()
  except PermissionError as e:self.send('Acceso restringido','<h1>Acceso restringido</h1><p>'+esc(e)+'</p>',self.getuser(),status=403)
  except Exception as e:self.send('Error','<h1>No se pudo completar la operación</h1><p>Verifica los datos y vuelve a intentarlo.</p>',self.getuser(),status=400)
 def do_POST(self):
  try:
   f=self.form();u=self.getuser()
   if u and not hmac.compare_digest(f.get('csrf',''),u['csrf']):raise PermissionError('La solicitud no es válida. Actualiza la página.')
   self.handle_post(f,u)
  except (ValueError,sqlite3.IntegrityError,PermissionError) as e:self.send('Validación','<h1>Revisa la solicitud</h1><p>'+esc(str(e))+'</p><a href="javascript:history.back()">Volver</a>',self.getuser(),status=400)
  except Exception:self.send('Error','<h1>Error inesperado</h1><p>La operación no fue confirmada. Revisa los registros antes de intentar nuevamente.</p>',self.getuser(),status=500)
 def handle_get(self):
  path=urllib.parse.urlsplit(self.path).path;u=self.getuser()
  if path=='/logo':
   with db() as c:r=c.execute("SELECT v FROM settings WHERE k='logo'").fetchone()
   if not r or not r['v']:self.send_error(404);return
   p=ROOT/'assets'/r['v'];
   if not p.is_file():self.send_error(404);return
   data=p.read_bytes();self.send_response(200);self.send_header('Content-Type',mimetypes.guess_type(str(p))[0] or 'application/octet-stream');self.send_header('Content-Length',str(len(data)));self.end_headers();self.wfile.write(data);return
  with db() as c:
   if path=='/':
    courses=c.execute('SELECT * FROM courses WHERE active=1 LIMIT 6').fetchall();cards=''.join(f'<div class="card"><h2>{esc(x["title"])}</h2><p>{esc(x["mode"])} · <strong>${x["price"]:,} CLP</strong></p><p>Cupos: {x["seats"]}</p><a class="btn" href="/postular">Postular</a></div>' for x in courses)
    self.send('Inicio','<section class="hero"><h1>Bienvenidos a SEMATEC</h1><p>Formación, postulaciones e inscripciones desde un mismo lugar.</p><a class="btn" href="/postular">Postular ahora</a> <a class="btn" href="/contacto">Contactar con un asesor</a></section><div class="grid">'+cards+'</div>',u);return
   if path=='/cursos':
    rows=c.execute('SELECT * FROM courses WHERE active=1').fetchall();self.send('Cursos','<h1>Carreras y cursos</h1><div class="grid">'+''.join(f'<div class="card"><h2>{esc(r["title"])}</h2><p>{esc(r["mode"])}</p><strong>${r["price"]:,} CLP</strong><p>Cupos: {r["seats"]}</p><a class="btn" href="/postular">Postular ahora</a></div>' for r in rows)+'</div>',u);return
   if path=='/postular':
    courses=c.execute('SELECT * FROM courses WHERE active=1').fetchall();form='<h1>Postulación online</h1><div class="panel"><form method="post">'+field('Nombre completo','name')+field('Correo','email','email')+field('RUT o pasaporte','document')+select('Curso','course',[(r['id'],r['title']) for r in courses])+'<button>Enviar postulación</button></form></div><p class="muted">Postular no equivale a matrícula. No se realizan cobros reales en esta demostración.</p>';self.send('Postulación',form,u);return
   if path=='/contacto':
    s=dict((r['k'],r['v']) for r in c.execute('SELECT * FROM settings'))
    wa=re.sub(r'\D','',s['whatsapp']);link=f'<p><a class="btn" href="https://wa.me/{wa}">Contactar por WhatsApp</a></p>' if wa else ''
    self.send('Contacto','<h1>Contacto institucional</h1>'+link+'<div class="panel"><form method="post">'+field('Nombre','name')+field('Correo','email','email')+'<label>Mensaje<textarea name="message" required maxlength="2000"></textarea></label><button>Enviar consulta</button></form></div>',u);return
   if path=='/ingresar':self.send('Iniciar sesión','<h1>Iniciar sesión</h1><div class="panel" style="max-width:500px"><form method="post">'+field('Correo','email','email')+field('Contraseña','password','password')+'<button>Entrar</button></form></div>',u);return
   if path=='/panel':
    u=self.require();counts={name:c.execute('SELECT COUNT(*) FROM '+table).fetchone()[0] for name,table in [('Cursos','courses'),('Postulaciones','applications'),('Matrículas','enrollments'),('Pagos','payments'),('Consultas','contacts')]};self.send('Panel','<h1>Panel '+esc(u['role'])+'</h1><p>Bienvenido/a, '+esc(u['name'])+'</p><div class="grid">'+''.join(f'<div class="card"><h2>{esc(k)}</h2><p style="font-size:32px;font-weight:800">{v}</p></div>' for k,v in counts.items())+'</div><p class="muted">Los indicadores son datos de demostración en la base local.</p>',u);return
   if path=='/admin':
    u=self.require(['admin']);courses=c.execute('SELECT * FROM courses ORDER BY id DESC').fetchall();apps=c.execute('SELECT a.*,c.title FROM applications a JOIN courses c ON c.id=a.course_id ORDER BY a.id DESC').fetchall();contacts=c.execute('SELECT * FROM contacts ORDER BY id DESC LIMIT 20').fetchall();
    part='<h1>Administración institucional</h1><h2>Crear curso</h2><div class="panel"><form method="post" action="/crear-curso">'+token(u)+field('Nombre','title')+select('Modalidad','mode',[(x,x) for x in ['Presencial','Online','Híbrido']])+field('Precio CLP','price','number')+field('Cupos','seats','number')+'<button>Crear curso</button></form></div><h2>Postulaciones</h2><div class="scroll"><table><tr><th>ID</th><th>Nombre</th><th>Curso</th><th>Documento</th><th>Estado</th><th>Acción</th></tr>'
    for a in apps:
     part+=f'<tr><td>{a["id"]}</td><td>{esc(a["name"])}<br>{esc(a["email"])}</td><td>{esc(a["title"])}</td><td>{esc(a["document"])}</td><td>{esc(a["status"])}</td><td><form class="inline" method="post" action="/estado-postulacion">{token(u)}<input type="hidden" name="id" value="{a["id"]}">'+select('','status',[(s,s) for s in STATES])+'<button>Actualizar</button></form></td></tr>'
    part+='</table></div><h2>Consultas recibidas</h2><div class="grid">'+''.join(f'<div class="card"><strong>{esc(r["name"])} · {esc(r["email"])}</strong><p>{esc(r["message"])}</p></div>' for r in contacts)+'</div><h2>Últimos eventos de auditoría</h2><div class="panel">'+''.join(f'<p>{esc(r["created"])} · {esc(r["user"])} · {esc(r["event"])}</p>' for r in c.execute('SELECT * FROM audit ORDER BY id DESC LIMIT 15'))+'</div>';self.send('Administración',part,u);return
   if path=='/matriculas':
    u=self.require(['admin','admision','finanzas']);rows=c.execute('SELECT a.id,a.name,a.status,a.email,c.title,e.id eid,e.status es FROM applications a JOIN courses c ON c.id=a.course_id LEFT JOIN enrollments e ON e.application_id=a.id ORDER BY a.id DESC').fetchall();p='<h1>Inscripciones y matrículas</h1><div class="scroll"><table><tr><th>Postulante</th><th>Curso</th><th>Postulación</th><th>Inscripción</th><th>Acción</th></tr>'
    for r in rows:
     p+=f'<tr><td>{esc(r["name"])}<br>{esc(r["email"])}</td><td>{esc(r["title"])}</td><td>{esc(r["status"])}</td><td>{esc(r["es"] or "Sin inscripción")}</td><td>'
     if r['status']=='Aprobada' and not r['eid']:p+=f'<form method="post" action="/inscribir">{token(u)}<input type="hidden" name="id" value="{r["id"]}"><button>Crear inscripción</button></form>'
     p+='</td></tr>'
    self.send('Matrículas',p+'</table></div>',u);return
   if path=='/pagos':
    u=self.require(['admin','finanzas']);rows=c.execute('SELECT e.id eid,e.status es,a.name,c.title,c.price,p.id pid,p.amount,p.status ps,p.method FROM enrollments e JOIN applications a ON a.id=e.application_id JOIN courses c ON c.id=a.course_id LEFT JOIN payments p ON p.enrollment_id=e.id ORDER BY e.id DESC').fetchall();s='<h1>Pagos (registro manual / simulación)</h1><p class="alert">No procesa transferencias ni tarjetas reales. No confirma fondos bancarios automáticamente.</p><div class="scroll"><table><tr><th>Inscripción</th><th>Curso / monto</th><th>Pago</th><th>Registrar / validar</th></tr>'
    for r in rows:
     s+=f'<tr><td>#{r["eid"]} {esc(r["name"])}</td><td>{esc(r["title"])}<br>${r["price"]:,}</td><td>{esc(r["ps"] or "Pendiente")}</td><td>'
     if not r['pid']:s+=f'<form method="post" action="/crear-pago">{token(u)}<input type="hidden" name="enrollment" value="{r["eid"]}">'+select('','method',[(x,x) for x in ['Transferencia','Efectivo','Tarjeta (registro manual)']])+field('Referencia','reference',required=False)+'<button>Registrar pendiente</button></form>'
     elif r['ps']!='Pagado':s+=f'<form method="post" action="/validar-pago">{token(u)}<input type="hidden" name="id" value="{r["pid"]}"><button>Confirmar pago manual</button></form>'
     s+='</td></tr>'
    self.send('Pagos',s+'</table></div>',u);return
   if path=='/usuarios':
    u=self.require(['admin']);rs=c.execute('SELECT id,name,email,role,active FROM users').fetchall();v='<h1>Usuarios y roles</h1><div class="panel"><form method="post" action="/crear-usuario">'+token(u)+field('Nombre','name')+field('Correo','email','email')+field('Contraseña inicial (mínimo 10 caracteres)','password','password')+select('Rol','role',[(x,x) for x in ['admin','admision','finanzas','profesor','estudiante']])+'<button>Crear usuario</button></form></div><h2>Usuarios registrados</h2><div class="scroll"><table><tr><th>Nombre</th><th>Correo</th><th>Rol</th><th>Estado</th></tr>'+''.join(f'<tr><td>{esc(r["name"])}</td><td>{esc(r["email"])}</td><td>{esc(r["role"])}</td><td>{"Activo" if r["active"] else "Inactivo"}</td></tr>' for r in rs)+'</table></div>';self.send('Usuarios',v,u);return
   if path=='/configuracion':
    u=self.require(['admin']);s={r['k']:r['v'] for r in c.execute('SELECT * FROM settings')};part='<h1>Configuración Institucional</h1><div class="panel"><form method="post" action="/guardar-configuracion">'+token(u)+field('Nombre del instituto','name',value=s['name'])+field('WhatsApp internacional (solo números)','whatsapp',required=False,value=s['whatsapp'])+field('Correo de contacto','contact_email',required=False,value=s['contact_email'])+field('Datos de transferencia (solo demostración)','bank',required=False,value=s['bank'])+'<button>Guardar cambios</button></form></div><h2>Cambiar logo</h2><div class="panel"><p>Admite PNG/JPEG/GIF/WEBP hasta 500 KB. Debe cargarse una imagen real.</p><form method="post" action="/guardar-logo" enctype="multipart/form-data">'+token(u)+'<label>Imagen del logo (PNG o JPG, máximo 500 KB)<input type="file" name="logo_file" accept="image/png,image/jpeg" required></label><button>Guardar logo</button></form></div>';self.send('Configuración',part,u);return
  self.send('No encontrado','<h1>Página no encontrada</h1>',u,status=404)
 def handle_post(self,f,u):
  path=urllib.parse.urlsplit(self.path).path
  def needed(*keys):
   for k in keys:
    if not f.get(k):raise ValueError('Falta completar: '+k)
  with db() as c:
   if path=='/ingresar':
    needed('email','password');r=c.execute('SELECT * FROM users WHERE email=? AND active=1',(f['email'].lower(),)).fetchone()
    if not r or not verify(f['password'],r['password']):raise ValueError('Correo o contraseña incorrectos')
    sid=secrets.token_urlsafe(32);SESS[sid]={'id':r['id'],'role':r['role'],'name':r['name'],'email':r['email'],'csrf':secrets.token_urlsafe(24),'expiry':time.time()+8*3600};audit(c,r['email'],'Inicio de sesión');self.redirect('/panel','sid='+sid+'; HttpOnly; SameSite=Lax; Path=/');return
   if path=='/salir':
    if u:SESS.pop(next((k for k,v in SESS.items() if v is u),''),None)
    self.redirect('/','sid=; Max-Age=0; HttpOnly; SameSite=Lax; Path=/');return
   if path=='/postular':
    needed('name','email','document','course')
    if not re.fullmatch(r'[^@\s]+@[^@\s]+\.[^@\s]+',f['email']):raise ValueError('Correo inválido')
    if not c.execute('SELECT 1 FROM courses WHERE id=? AND active=1',(f['course'],)).fetchone():raise ValueError('Curso no disponible')
    c.execute('INSERT INTO applications(name,email,document,course_id) VALUES(?,?,?,?)',(f['name'][:160],f['email'][:200],f['document'][:40],int(f['course'])));i=c.execute('SELECT last_insert_rowid()').fetchone()[0]
    self.send('Postulación enviada',f'<div class="panel"><h1>Postulación recibida</h1><p>Número de seguimiento: <strong>SEM-{i:06d}</strong></p><p>La solicitud queda en revisión y todavía no constituye matrícula.</p></div>',u);return
   if path=='/contacto':
    needed('name','email','message');c.execute('INSERT INTO contacts(name,email,message) VALUES(?,?,?)',(f['name'][:150],f['email'][:150],f['message'][:2000]));self.send('Consulta recibida','<h1>Consulta registrada</h1><p>El instituto podrá verla en el panel administrativo. Esta versión no envía correos automáticamente.</p>',u);return
   if not u:raise PermissionError('Inicia sesión para continuar')
   def role(*rs):
    if u['role'] not in rs:raise PermissionError('Permiso insuficiente')
   if path=='/crear-curso':
    role('admin');needed('title','mode','price','seats');price,seats=int(f['price']),int(f['seats']);
    if price<0 or seats<0:raise ValueError('Precio y cupos no pueden ser negativos')
    c.execute('INSERT INTO courses(title,mode,price,seats) VALUES(?,?,?,?)',(f['title'][:180],f['mode'],price,seats));audit(c,u['email'],'Creó curso '+f['title'][:80]);self.redirect('/admin');return
   if path=='/estado-postulacion':
    role('admin');needed('id','status')
    if f['status'] not in STATES:raise ValueError('Estado inválido')
    c.execute('UPDATE applications SET status=? WHERE id=?',(f['status'],int(f['id'])));audit(c,u['email'],'Estado postulación '+f['id']+' -> '+f['status']);self.redirect('/admin');return
   if path=='/inscribir':
    role('admin','admision');r=c.execute('SELECT * FROM applications WHERE id=?',(f['id'],)).fetchone()
    if not r or r['status']!='Aprobada':raise ValueError('Postulación no aprobada')
    c.execute('INSERT INTO enrollments(application_id) VALUES(?)',(r['id'],));audit(c,u['email'],'Creó inscripción de '+f['id']);self.redirect('/matriculas');return
   if path=='/crear-pago':
    role('admin','finanzas');needed('enrollment','method');r=c.execute('SELECT c.price FROM enrollments e JOIN applications a ON a.id=e.application_id JOIN courses c ON c.id=a.course_id WHERE e.id=?',(f['enrollment'],)).fetchone()
    if not r:raise ValueError('Matrícula inexistente')
    if f['method'] not in ('Transferencia','Efectivo','Tarjeta (registro manual)'):raise ValueError('Medio inválido')
    if c.execute('SELECT 1 FROM payments WHERE enrollment_id=?',(f['enrollment'],)).fetchone():raise ValueError('Ya existe un pago registrado')
    c.execute('INSERT INTO payments(enrollment_id,amount,method,reference,status) VALUES(?,?,?,?,?)',(int(f['enrollment']),r['price'],f['method'],f.get('reference','')[:120],'En verificación'));audit(c,u['email'],'Registró pago pendiente '+f['enrollment']);self.redirect('/pagos');return
   if path=='/validar-pago':
    role('admin','finanzas');r=c.execute('SELECT * FROM payments WHERE id=?',(f.get('id'),)).fetchone()
    if not r or r['status']=='Pagado':raise ValueError('Pago inexistente o ya confirmado')
    c.execute("UPDATE payments SET status='Pagado' WHERE id=?",(r['id'],));c.execute("UPDATE enrollments SET status='En revisión' WHERE id=?",(r['enrollment_id'],));audit(c,u['email'],'Confirmó pago manual '+str(r['id']));self.redirect('/pagos');return
   if path=='/crear-usuario':
    role('admin');needed('name','email','password','role')
    if len(f['password'])<10:raise ValueError('La contraseña debe tener al menos 10 caracteres')
    if f['role'] not in ('admin','admision','finanzas','profesor','estudiante'):raise ValueError('Rol inválido')
    c.execute('INSERT INTO users(name,email,password,role) VALUES(?,?,?,?)',(f['name'][:150],f['email'].lower()[:180],pw(f['password']),f['role']));audit(c,u['email'],'Creó usuario '+f['email']);self.redirect('/usuarios');return
   if path=='/guardar-logo':
    role('admin')
    data=f.get('logo_file')
    if not isinstance(data,bytes) or not data:raise ValueError('Selecciona una imagen PNG o JPEG')
    if len(data)>500_000:raise ValueError('El archivo supera el máximo de 500 KB')
    if data.startswith(b'\x89PNG\r\n\x1a\n'): ext='png'
    elif data.startswith(b'\xff\xd8\xff'): ext='jpg'
    else:raise ValueError('Formato inválido: se requiere PNG o JPEG')
    folder=ROOT/'assets';folder.mkdir(exist_ok=True)
    filename='logo-'+secrets.token_hex(8)+'.'+ext
    (folder/filename).write_bytes(data)
    previous=c.execute("SELECT v FROM settings WHERE k='logo'").fetchone()['v']
    c.execute("UPDATE settings SET v=? WHERE k='logo'",(filename,))
    audit(c,u['email'],'Cambió logo institucional')
    if previous and previous.startswith('logo-'):
     try:(folder/previous).unlink(missing_ok=True)
     except OSError:pass
    self.redirect('/configuracion');return
   if path=='/guardar-configuracion':
    role('admin');needed('name')
    for key in ['name','whatsapp','contact_email','bank']:c.execute('UPDATE settings SET v=? WHERE k=?',(f.get(key,'')[:500],key))
    audit(c,u['email'],'Actualizó configuración institucional');self.redirect('/configuracion');return
  raise ValueError('Ruta de operación no encontrada')
if __name__=='__main__':
 init();server=ThreadingHTTPServer(('127.0.0.1',PORT),Handler)
 print(f'ABRE EN TU COMPUTADOR: http://127.0.0.1:{PORT}',flush=True)
 try:server.serve_forever()
 except KeyboardInterrupt:pass
