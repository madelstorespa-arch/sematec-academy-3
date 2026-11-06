# SEMATEC GLOBAL 10.0 — Base de datos (PostgreSQL / Supabase)

Capa de datos real de la plataforma: esquema, seguridad a nivel de fila (RLS), reglas de negocio transaccionales, auditoría protegida y pruebas automáticas. Corresponde al documento maestro de requisitos (v1.0, noviembre 2026) y a los anexos de *Funcionamiento real y almacenamiento en la nube* y *Ciberseguridad avanzada*.

## Estado honesto

| Ámbito | Estado |
|---|---|
| Esquema completo de la §6 (64 tablas), RLS en el 100 % de las tablas, 138 políticas | ✅ Construido y probado |
| Reglas transaccionales: matrícula con cupos, notas y actas, cuotas/pagos/reversos, certificados, conferencias | ✅ Construido y probado |
| Auditoría inmutable encadenada por hash (47 tablas auditadas) | ✅ Construido y probado |
| Pruebas: 169 verificaciones + concurrencia real + respaldo/restauración | ✅ Todas aprobadas en PostgreSQL 16 local |
| Ejecución sobre **tu** proyecto Supabase | ⏳ Pendiente: requiere tus credenciales (ver “Instalación”) |
| Frontend Next.js, Edge Functions, servidor LiveKit, pasarela de pagos | ❌ Fuera de este entregable (capa de datos solamente) |

Las pruebas se ejecutaron en un PostgreSQL 16 local que emula `auth.uid()`, los roles `anon`/`authenticated`/`service_role` y `storage.objects` de Supabase (`tests/local/00_supabase_shim.sql`). Antes de declarar el módulo terminado en la nube hay que repetirlas con `supabase start` (instrucciones abajo).

## Estructura

```
supabase/
  migrations/                       14 migraciones SQL versionadas (aplicar en orden)
    ..0100_fundacion                extensiones, esquema private, tipos
    ..0200_instituciones            instituciones, sedes, salas, configuración, países
    ..0300_seguridad_y_auditoria    perfiles, roles, permisos, membresías, MFA, auditoría
    ..0400_catalogo_permisos_roles  133 permisos y 24 roles base del documento (§3)
    ..0500_personas                 estudiantes, profesores, personal, contratos, CRM
    ..0600_academico                programas, mallas, cursos, periodos, secciones, horarios
    ..0700_admision_matriculas      postulaciones, matrículas, inscripción de asignaturas
    ..0800_clases_evaluacion        libro de clases, asistencia, evaluaciones, actas
    ..0900_finanzas                 aranceles, becas, cuotas, pagos, reembolsos, conciliación
    ..1000_certificados             certificados verificables y requisitos de egreso
    ..1100_conferencias             Sistema 51: salas, sesiones, tokens, asistencia, grabaciones
    ..1200_documental_storage...    documentos versionados, buckets privados, notificaciones
    ..1300_reportes_y_privilegios   reportes y endurecimiento de privilegios
    ..1400_datos_referencia         monedas y países
  seed.sql                          datos ficticios de prueba (solo desarrollo)
tests/
  sql/                              pruebas SQL (00_helpers + 5 suites)
  run_local.sh                      corre todo en un PostgreSQL limpio
  run_supabase.sh                   corre las pruebas en `supabase start`
  concurrency_test.sh               carreras reales entre dos conexiones
  backup_restore_test.sh            pg_dump → restauración → verificación
  resultados_pruebas.txt            evidencia de la última ejecución
docs/modelo-datos.md                diagrama entidad-relación y matriz de requisitos
```

## Instalación en Supabase

Requisitos: [Supabase CLI](https://supabase.com/docs/guides/cli), Docker (para el entorno local) y `psql`.

```bash
# 1. Entorno local: aplica migraciones + seed y corre las pruebas
supabase start
supabase db reset
bash tests/run_supabase.sh

# 2. Proyecto en la nube (SIN seed)
supabase link --project-ref <ref-de-tu-proyecto>
supabase db push            # aplica solo supabase/migrations/
```

`seed.sql` crea usuarios y personas ficticias: **no** debe cargarse en producción. `supabase db push` no lo ejecuta.

### Configuración obligatoria en el panel de Supabase (Authentication)

La base de datos ya exige MFA (`aal2`) a los roles administrativos, pero estas opciones se activan en el panel:

1. **MFA → TOTP habilitado** (sin esto, ningún administrador podrá operar).
2. **Política de contraseñas**: mínimo 12 caracteres, mayúsculas, números y símbolos; activar *Leaked password protection*.
3. **Rate limits** de inicio de sesión y recuperación de contraseña.
4. **Sesiones**: expiración del JWT (≤ 1 h) y *refresh token rotation* activada.
5. **Plantillas de correo** para recuperación de contraseña y avisos de cambios de cuenta.
6. **Primer superadministrador**: crear el usuario en Auth y luego, una sola vez en el SQL Editor:
   `update public.profiles set is_platform_admin = true where email = '<correo>';`
7. **Respaldos**: activar Point-in-Time Recovery (plan Pro o superior) y programar una prueba de restauración trimestral con `tests/backup_restore_test.sh`.

## Cómo se usa desde la aplicación

Las lecturas se hacen normalmente (`supabase.from('students').select()`); RLS filtra por institución, sede y rol. Las operaciones críticas **solo** existen como funciones:

```ts
await supabase.rpc('register_section', { p_student, p_section })        // cupos, prerrequisitos, choques
await supabase.rpc('close_section_grades', { p_section })                 // acta: promedio, asistencia, resultado
await supabase.rpc('create_charge', { p_student, p_concept: 'tuition', p_gross: 1000000, p_currency: 'CLP', p_installments: 10, p_first_due: '2027-03-05' })
await supabase.rpc('register_payment', { p_student, p_amount, p_currency: 'CLP', p_method: 'bank_transfer', p_provider: 'banco', p_external_reference: 'TRX-123' })
await supabase.rpc('void_payment', { p_payment, p_reason })               // exige MFA
await supabase.rpc('issue_certificate', { p_template, p_student, p_course })
await supabase.rpc('verify_certificate', { p_code: 'ABCD-EFGH-JKLM-NPQR' }) // público (QR)
await supabase.rpc('authorize_conference_join', { p_session })           // Edge Function firma el token LiveKit con estos grants
```

Si la red falla, la llamada RPC devuelve error y la transacción no se confirma: la interfaz debe mostrar “no guardado, reintentar”, nunca “guardado” (requisito §7 del anexo de funcionamiento real). Pagos y webhooks son idempotentes (`external_reference`, `idempotency_key`), por lo que reintentar no duplica.

**Conferencias (LiveKit):** la Edge Function `livekit-token` (pendiente) llama a `authorize_conference_join` con el JWT del usuario y, solo si `allowed = true`, firma un AccessToken con exactamente los `grants` y `expires_at` devueltos. El webhook de LiveKit llama a `record_conference_event` con la clave `service_role`. Las claves de LiveKit y `service_role` viven solo en los secretos de Edge Functions, nunca en el navegador ni en GitHub.

## Decisiones de seguridad

- **Aislamiento por institución** en cuatro capas: RLS, claves foráneas compuestas `(organization_id, id)` que impiden mezclar registros de dos instituciones, rutas de Storage con prefijo `<organization_id>/` y validación en cada función.
- **Privilegio mínimo**: `anon` solo puede ejecutar `verify_certificate`. Pagos, notas cerradas, membresías y certificados no se escriben directamente: solo mediante funciones que validan permiso, MFA y motivo.
- **Anti-escalamiento**: nadie se asigna roles a sí mismo ni otorga o crea roles con permisos que no posee; las columnas `is_platform_admin` y `status` del perfil no son editables por el usuario.
- **Soporte técnico** no ve datos personales; el superadministrador tampoco, salvo que reciba membresía.
- **Nada se borra**: pagos, cuotas, certificados, historial de notas, versiones de documentos y auditoría están protegidos por disparadores incluso frente al superusuario; se corrigen mediante anulación, reverso o revocación con motivo.
- **Auditoría encadenada**: cada evento incluye el hash del anterior; `verify_audit_chain()` detecta cualquier alteración o hueco (probado manipulando un registro).

## Pruebas

```bash
PGHOST=... PGPORT=... PGUSER=postgres bash tests/run_local.sh
```

Última ejecución (ver `tests/resultados_pruebas.txt`):

| Suite | Verificaciones |
|---|---|
| 01 Aislamiento entre instituciones, sedes y roles | 26 |
| 02 MFA, anti-escalamiento, bloqueo por intentos, auditoría | 28 |
| 03 Horarios, cupos, prerrequisitos, asistencia, notas, actas, rectificación | 32 |
| 04 Cuotas, pagos, reembolsos, anulaciones, conciliación | 31 |
| 05 Certificados, conferencias, documentos, Storage, postulaciones, reportes | 49 |
| Concurrencia real (último cupo, doble pago) | 2 |
| Respaldo y restauración | 1 |
| **Total** | **169 — 0 fallas** |

## Pendiente para cumplir el documento completo

- Repetir las pruebas en `supabase start` y en un proyecto de *staging* (criterios 07, 12 y 13 requieren la nube y dispositivos reales).
- Edge Functions: token LiveKit, webhook LiveKit, webhook de pasarela de pagos, envío de notificaciones y registro de `record_login_failure`.
- Pruebas de carga de conferencias (50 salas × 150 participantes) sobre la infraestructura LiveKit elegida.
- Módulos de las fases 07–09 (RR. HH. completo, compras, inventario, biblioteca, BI, IA supervisada) — el esquema está preparado para agregarlos como nuevas migraciones.
- Revisión jurídica y tributaria por país (documento maestro §14).
