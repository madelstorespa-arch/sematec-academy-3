# SEMATEC ACADEMY

Plataforma de gestión educativa con **sitio web público** (inicio, cursos con precios, nosotros, contacto, postulación y estado de solicitud), **pago en línea con Webpay Plus, Mercado Pago, Flow y Stripe**, y la plataforma interna: administración, estudiantes y profesores, oferta académica, matrículas, libro de clases, notas y actas, finanzas, certificados verificables por QR y aulas virtuales en vivo. Nombre, logo, colores, textos y cursos se cambian desde el panel, sin tocar código.

Stack: **Next.js 15 + TypeScript**, **Supabase** (PostgreSQL, Auth con MFA) y **LiveKit** (videoconferencia WebRTC).

---

## 1. Estado de esta versión

**Probado de punta a punta** con Supabase Auth, la API REST de Supabase (PostgREST), PostgreSQL 16 y un servidor LiveKit real, todos ejecutándose en local:

| Prueba | Resultado |
|---|---|
| Base de datos: seguridad, aislamiento entre instituciones, cálculos y finanzas (`npm run test:db`) | **169 / 169** |
| Navegador real (Chrome), de punta a punta, con usuarios de distintos roles (`tests/e2e/e2e.py`) | **42 / 42** |
| Sitio público, compras con los 4 medios de pago, postulación, marca y foto de perfil (`tests/e2e/e2e_web.py`) | **50 / 50** |
| Concurrencia: último cupo y doble pago simultáneos | ✔ |
| Respaldo y restauración verificados | ✔ |

Las pruebas de punta a punta incluyen: inicio de sesión y MFA reales; registro de estudiante visible desde otra sesión; mensaje correcto sin internet (nada se guarda); matrícula con cuotas; pagos, duplicados y anulaciones; notas, asistencia y cierre de acta; portal del estudiante; certificado verificado sin sesión; y **profesora y estudiante conectados por video en LiveKit**, con la asistencia registrada por webhook. Las capturas están en `docs/capturas/`.

**Lo que falta para usarla con usuarios reales:** publicarla en *tus* cuentas de Supabase, Vercel y LiveKit (sección 3). Solo tú puedes crear esas cuentas.

## 2. Módulos incluidos

| Módulo | Quién lo usa | Qué hace |
|---|---|---|
| Inicio de sesión, MFA, recuperación de contraseña | Todos | MFA obligatoria para roles administrativos; bloqueo tras 5 intentos fallidos |
| Instituciones | Superadministrador | Crear instituciones con su propietario |
| Configuración | Propietario / directores | Datos institucionales, sedes, salas, reglas configurables |
| Usuarios y roles | Administración (con MFA) | Asignar/revocar roles por sede, suspender cuentas, roles personalizados |
| Estudiantes / Profesores | Secretaría, RR. HH. | Fichas con validación, expediente, acceso al portal |
| Oferta académica | Dirección académica | Programas, mallas, asignaturas, prerrequisitos, periodos, escalas de notas |
| Secciones | Coordinación / profesores | Horarios sin choques, inscritos con control de cupos, libro de clases, asistencia, notas, cierre y rectificación de actas |
| Matrículas | Matrículas | Matrícula en programa con arancel en cuotas y becas |
| Finanzas | Tesorería | Estados de cuenta, morosidad, cargos, pagos, anulaciones, reembolsos |
| Certificados | Secretaría | Emisión con validación de requisitos, impresión/PDF con QR, revocación, verificación pública |
| Aulas virtuales | Profesores, estudiantes, organizadores | Salas por sección, sesiones, video/audio/chat/pantalla, moderación, asistencia automática, certificados de asistencia |
| Reportes | Dirección | Matrícula, rendimiento académico y finanzas |
| Auditoría | Auditor | Registro inmutable y verificación de integridad |
| Mi portal / Mis secciones | Estudiante / Profesor | Vistas propias de cada rol |

### Sitio público y pagos en línea

- **Visitantes (sin cuenta):** portada, cursos con precio, detalle del curso, Nosotros, Contacto (con WhatsApp), Términos y Privacidad, verificación de certificados y **Estado de solicitud** (con código de seguimiento + correo).
- **Ingreso a un curso:** cada curso se configura como *pago inmediato* (paga → se crea la cuenta, la ficha, la matrícula y el pago en Finanzas → crea su contraseña y entra) o *con postulación* (postula → admisión aprueba en **Admisión web** → paga desde Estado de solicitud → acceso).
- **Seguridad de los pagos:** el monto siempre sale del catálogo, el resultado se confirma consultando directamente al proveedor (nunca con datos del navegador), los webhooks verifican firma, cada pago se procesa una sola vez y un monto alterado se rechaza con alerta crítica. SEMATEC ACADEMY nunca ve ni guarda datos de tarjetas.
- **Sin tocar código** (menú **Sitio web y marca**): nombre de la academia, lema, logo, imagen de portada, colores, textos, destacados, contacto, redes sociales, términos, privacidad, publicar/despublicar y el catálogo de cursos con precio, cupos, imagen y modalidad. Cada usuario puede subir su **foto de perfil** en Mi cuenta.

> Los pagos se probaron contra un servidor de pruebas que reproduce las API de los cuatro proveedores (`tests/e2e/payment-mock.mjs`). Antes de cobrar de verdad, haga una compra en el ambiente *sandbox/integración* de cada proveedor que active.

## 3. Publicación paso a paso

### 3.1 Supabase (base de datos y autenticación)
1. Cree un proyecto en <https://supabase.com> (región recomendada para Chile: São Paulo).
2. En **Project Settings → API** copie: `Project URL`, `anon public` y `service_role` (esta última es secreta).
3. Instale la [Supabase CLI](https://supabase.com/docs/guides/cli) y, dentro de esta carpeta:
   ```bash
   supabase link --project-ref <ref-del-proyecto>
   supabase db push          # aplica las 15 migraciones de supabase/migrations
   ```
   No cargue `supabase/seed.sql` en producción: contiene personas ficticias de prueba.
4. **Authentication → Sign In / Providers → Multi-Factor**: active **TOTP**.
5. **Authentication → URL Configuration**: *Site URL* = su dominio (p. ej. `https://academy.sematec.cl`) y agregue `https://academy.sematec.cl/auth/confirm` en *Redirect URLs*.
6. **Authentication → Emails → SMTP**: configure su servidor de correo (Google Workspace, SendGrid, Amazon SES, etc.). El correo incluido en Supabase solo envía unos pocos mensajes por hora.
7. **Authentication → Emails → Templates**: en *Reset Password* e *Invite user*, use como enlace:
   `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=recovery` (para *Invite*, `type=invite`).
8. **Authentication → Policies / Rate limits**: contraseñas de al menos 12 caracteres y *Leaked password protection* activada.
9. **Database → Backups**: active Point-in-Time Recovery (requiere un plan pagado de Supabase).

### 3.2 LiveKit Cloud (videoconferencias)
1. Cree un proyecto en <https://cloud.livekit.io>.
2. En **Settings → Keys** cree una clave y copie `API Key`, `API Secret` y la URL `wss://…livekit.cloud`.
3. En **Settings → Webhooks** agregue `https://<su-dominio>/api/livekit/webhook` con esa misma clave.

### 3.3 Medios de pago (active solo los que usará)
| Proveedor | Dónde se obtienen las claves | Variables en Vercel | Notificaciones |
|---|---|---|---|
| Webpay Plus | Contrato Webpay Plus con Transbank (código de comercio y API Key) | `WEBPAY_ENABLED=1`, `WEBPAY_ENV=production`, `WEBPAY_COMMERCE_CODE`, `WEBPAY_API_KEY` | No requiere |
| Mercado Pago | Mercado Pago Developers → Tus integraciones → Credenciales | `MERCADOPAGO_ACCESS_TOKEN`, `MERCADOPAGO_WEBHOOK_SECRET` | Webhooks → `https://<dominio>/api/pago/webhook/mercadopago` (evento Pagos) |
| Flow | Flow → Integraciones → Datos de API | `FLOW_ENV=production`, `FLOW_API_KEY`, `FLOW_SECRET_KEY` | Automática en cada pago |
| Stripe | Dashboard → Developers → API keys | `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` | Webhooks → `https://<dominio>/api/pago/webhook/stripe` (eventos `checkout.session.*`) |

Agregue también `PAYMENT_LINK_SECRET` (un texto aleatorio largo). Para probar Webpay sin contrato use `WEBPAY_ENABLED=1` con `WEBPAY_ENV=integration` (credenciales públicas de Transbank, tarjeta de prueba 4051 8856 0044 6623). En el panel, **Sitio web y marca → Medios de pago** muestra cuáles están activos.

### 3.4 GitHub y Vercel (publicación web)
1. Suba esta carpeta a un repositorio **privado** de GitHub (el archivo `.env.local` nunca se sube; ya está en `.gitignore`).
2. En <https://vercel.com>: **Add New → Project →** importe el repositorio.
3. En **Environment Variables** cargue las variables de `.env.example`:

   | Variable | Valor |
   |---|---|
   | `NEXT_PUBLIC_SUPABASE_URL` | Project URL |
   | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | anon public |
   | `SUPABASE_SERVICE_ROLE_KEY` | service_role (**secreta**) |
   | `NEXT_PUBLIC_SITE_URL` | `https://academy.sematec.cl` |
   | `NEXT_PUBLIC_LIVEKIT_URL` | `wss://…livekit.cloud` |
   | `LIVEKIT_API_KEY` / `LIVEKIT_API_SECRET` | Claves de LiveKit (**secretas**) |
4. Presione **Deploy**. Luego, en **Settings → Domains**, conecte su dominio.

### 3.5 Primer ingreso
1. En Supabase, **Authentication → Users → Add user**: cree su usuario con contraseña.
2. En **SQL Editor** ejecute una sola vez:
   `update public.profiles set is_platform_admin = true where email = 'su-correo@dominio.cl';`
3. Entre a la plataforma: se le pedirá configurar MFA con Google/Microsoft Authenticator.
4. Vaya a **Instituciones** y cree SEMATEC con su propietario. Luego, en **Sitio web y marca**, cargue nombre, logo, textos y cursos, y marque «Publicar el sitio web». Desde ese momento todo se administra desde la plataforma, en este orden: Configuración (sedes y salas) → Oferta académica (escala de notas, programas, asignaturas, periodos) → Profesores → Secciones → Estudiantes → Matrículas.

## 4. Desarrollo local

```bash
npm install
cp .env.example .env.local      # complete con un proyecto de pruebas o con `supabase start`
supabase start && supabase db reset
npm run demo:usuarios           # usuarios demo con contraseña Sematec-Demo-2026 (solo local)
npm run dev                     # http://localhost:3000
```

Pruebas: `npm run test:db` (requiere `psql` y PostgreSQL 15+) y `python3 tests/e2e/e2e.py` (requiere Playwright, `pyotp` y la app corriendo con LiveKit).

## 5. Seguridad aplicada

- Cada consulta del usuario pasa por **Row Level Security**: una institución nunca ve datos de otra, ni siquiera ante un error de la aplicación.
- Las operaciones críticas (matrícula, notas, pagos, certificados, conferencias) solo existen como funciones de la base de datos que validan permiso, sede, MFA y motivo.
- La clave `service_role` se usa solo en el servidor y únicamente para crear cuentas, registrar intentos fallidos y procesar el webhook de LiveKit.
- Cabeceras HTTP de seguridad (HSTS, anti-iframe, nosniff, política de permisos) y cookies de sesión gestionadas por Supabase.
- Auditoría encadenada por hash; pagos, certificados y notas cerradas no se borran ni se alteran.

Detalle de la base de datos: `docs/BASE_DE_DATOS.md` y `docs/modelo-datos.md`.

## 6. Próximas fases (no incluidas)

- Carga de documentos desde la interfaz (la base de datos y el almacenamiento privado ya están preparados).
- Boletas o facturas electrónicas (SII) por cada pago en línea.
- Correos automáticos (aviso de aprobación, comprobante de pago); grabación de clases (LiveKit Egress).
- Sistemas de las fases 07–10 del documento maestro: RR. HH. completo, compras, inventario, biblioteca, BI, IA supervisada, multi-idioma y pruebas de carga de 50 salas × 150 participantes.
