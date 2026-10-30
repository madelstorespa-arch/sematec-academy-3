# SEMATEC ACADEMY 3.0 — prototipo local verificable

**NO ES EL SISTEMA INTEGRAL TERMINADO.** Este paquete es una mejora comprobable de la demostración y no es apto para datos reales, tarjetas, producción ni exposición pública.

## Abrir en Windows
1. Instalar Python 3.11 o posterior.
2. Descomprimir el ZIP y ejecutar `INICIAR_WINDOWS.bat`.
3. Guardar la contraseña inicial que aparece en la consola.
4. Abrir `http://127.0.0.1:8080` en el mismo computador.
5. Acceder con `admin@sematec.local` y la contraseña generada.

## Funciones locales
- Formulario de postulación y contacto guardados en SQLite.
- Inicio de sesión, roles y CSRF para usuarios autenticados.
- Administración de cursos y usuarios.
- Aprobación de postulaciones, creación de matrícula y registro *manual de simulación* de pagos.
- Cambio de nombre y carga de logo PNG/JPEG (máximo 500 KB).
- Historial de auditoría.

## Limitaciones de seguridad y producto
- **No publicar este servidor en internet** ni usar con personas reales. Solo escucha 127.0.0.1.
- Los pagos son simulados; jamás confirman fondos reales.
- Sesiones almacenadas en RAM y base SQLite local: no es infraestructura escalable.
- Sin procesamiento online de inscripción con pago previo, pasarela, backend MySQL, Google OAuth, profesores, notas, asistencia, certificados ni roles granulares.
- Una implantación real exige refactor de seguridad, validación y políticas de privacidad, HTTPS, almacenamiento robusto, tests extensos y alojamiento.

## Pruebas automáticas
Ejecutar `python -m unittest -v test_sematec.py` (ver nombre real `test_sematec.py`).
