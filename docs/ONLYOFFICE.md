# Activar ONLYOFFICE en SEMATEC Oficina

SEMATEC Oficina funciona sin instalar nada más: tiene su propio editor de documentos, hojas de cálculo, presentaciones y publicaciones.
ONLYOFFICE se agrega aparte. Con él, los archivos de Word, Excel y PowerPoint se abren y se guardan **con el formato exacto de Office**, y varias personas pueden editar el mismo archivo en tiempo real.

La conexión ya está programada y probada. Solo falta el servidor de ONLYOFFICE, que contrata la institución.

---

## 1. Contratar un servidor (VPS)

- Requisitos mínimos de ONLYOFFICE: **4 GB de RAM, 2 núcleos y 40 GB de disco**.
- El sistema operativo puede ser Ubuntu 22.04 o 24.04.
- Necesita un subdominio que apunte a la IP del servidor, por ejemplo `docs.su-institucion.cl`. Se configura en el DNS con un registro **A**.
- Versión recomendada: **ONLYOFFICE Docs Community 9.4 o superior**. Desde la 9.4 la edición gratuita ya no limita a 20 conexiones simultáneas.
- La licencia es AGPL v3. El editor muestra el crédito «ONLYOFFICE»; no se quita.

## 2. Instalar ONLYOFFICE (en el servidor, no en el chat)

Entre al servidor por SSH y ejecute los pasos siguientes.

**a) Instalar Docker:**

```bash
curl -fsSL https://get.docker.com | sudo sh
```

**b) Crear un secreto largo y guardarlo:**

```bash
openssl rand -hex 32
```

> 🔐 Este secreto es una clave administrativa:
> - **No lo envíe por chat ni por correo.**
> - **No lo suba a GitHub.**
> - Cópielo solo en el servidor y en Vercel (paso 3).

**c) Iniciar ONLYOFFICE con HTTPS automático (Let's Encrypt).** Cambie el dominio, el correo y el secreto:

```bash
sudo docker run -i -t -d -p 80:80 -p 443:443 --restart=always \
  -v /app/onlyoffice/DocumentServer/data:/var/www/onlyoffice/Data \
  -v /app/onlyoffice/DocumentServer/logs:/var/log/onlyoffice \
  -e LETS_ENCRYPT_DOMAIN=docs.su-institucion.cl \
  -e LETS_ENCRYPT_MAIL=ti@su-institucion.cl \
  -e JWT_SECRET=EL_SECRETO_DEL_PASO_b \
  onlyoffice/documentserver
```

Espere unos minutos. Al abrir `https://docs.su-institucion.cl` debe aparecer la página de bienvenida de ONLYOFFICE.

## 3. Conectar la plataforma (Vercel)

1. En Vercel, abra el proyecto y vaya a **Settings → Environment Variables**.
2. Agregue estas variables solo en **Production**:

| Variable | Valor |
|---|---|
| `ONLYOFFICE_URL` | `https://docs.su-institucion.cl` (sin barra al final) |
| `ONLYOFFICE_JWT_SECRET` | el mismo secreto del paso 2b |

3. Vaya a **Deployments → … → Redeploy**. Es obligatorio volver a publicar, porque la política de seguridad del navegador (CSP) se prepara al publicar.

Las dos variables son **solo del servidor**: no llevan `NEXT_PUBLIC_` y el navegador nunca las ve.

## 4. Comprobar

1. Entre a **Oficina** y suba un archivo `.docx` o `.xlsx` con la casilla «Abrir con ONLYOFFICE (formato exacto)» marcada. Debe abrirse el editor de ONLYOFFICE.
2. Escriba algo y cierre la pestaña. A los ~10 segundos ONLYOFFICE avisa a la plataforma, que guarda una versión nueva. Puede verla en **🕘 Versiones**.
3. Si un documento ya existe en el editor propio, use el botón **🧩 Abrir en ONLYOFFICE**. La versión anterior queda guardada en el historial y se puede restaurar.

## Seguridad (ya incluida)

- Cada apertura lleva una configuración **firmada con JWT**. ONLYOFFICE rechaza configuraciones alteradas.
- ONLYOFFICE descarga los archivos con **enlaces firmados que vencen**.
- Los avisos de guardado se aceptan solo si traen la firma de la plataforma **y** el JWT de ONLYOFFICE.
- El archivo editado se descarga **solo desde el servidor ONLYOFFICE configurado**, lo que protege contra SSRF.
- Solo se guarda a nombre de personas con permiso de edición (el dueño, un editor invitado vigente, o la institución si el documento está compartido para editar).
- Los permisos son los mismos de la Oficina:
  - **Lector**: solo lectura.
  - **Comentarista**: puede comentar.
  - **Editor**: puede editar.
  - **Otra institución**: sin acceso, y el intento queda registrado en Auditoría.

## Si algo falla

| Síntoma | Causa probable |
|---|---|
| «No se pudo conectar con el servidor ONLYOFFICE» | `ONLYOFFICE_URL` mal escrita, servidor apagado o sin HTTPS |
| «El token de seguridad del documento tiene un formato incorrecto» | `ONLYOFFICE_JWT_SECRET` distinto del `JWT_SECRET` del servidor |
| El editor abre pero no guarda | El servidor ONLYOFFICE no llega a la plataforma. Revise el firewall del VPS (debe permitir salida HTTPS) |
| Un documento dice «se edita con ONLYOFFICE, que no está activo» | Faltan las variables en Vercel. Mientras tanto se puede descargar el archivo original |

Si quita las variables, la Oficina vuelve a usar solo su editor propio. No se pierde ningún documento.
