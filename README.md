# Appwrite Export Toolkit

[![Licencia: GPLv3](https://img.shields.io/badge/Licencia-GPLv3-blue.svg)](LICENSE)
[![Versión](https://img.shields.io/badge/Versión-0.1.0-green.svg)](package.json)
[![Node](https://img.shields.io/badge/Node-20%2B-lightgreen.svg)](package.json)

Herramienta de exportación estructuración, validación y restauración de backups lógicos para proyectos Appwrite self-hosted.

## Arquitectura

```
+-------------------------------------------------+
|              Panel Web (Next.js)                |
|   Dashboard - Exportar - Programar - Importar   |
+----------+--------------+--------------+--------+
           |              |              |
+----------v------+ +-----v-----+ +-----v------+
|  API Routes     | |  CLI      | | Scheduler  |
|  /api/export    | |  inspect  | |  (cron)    |
|  /api/import    | |  export   | |            |
|  /api/backups   | |  validate | |            |
|  /api/schedules | |  import   | |            |
|  /api/health    | |  delete   | |            |
+----------+------+ +-----+-----+ +-----+------+
           |              |              |
+----------v--------------v--------------v--------+
|              Servidor (src/server/)             |
|  Exporters - Importers - Validators - Backup    |
+----------------------+-------------------------+
                       |
              +--------v--------+
              |   Appwrite API  |
              |  Auth / DB /    |
              |  Storage        |
              +-----------------+
```

## ¿Qué hace esta aplicación?

Appwrite Export Toolkit permite crear **backups lógicos** completos de un proyecto Appwrite, exportando Auth, Databases y Storage a archivos estructurados (JSON, NDJSON) que pueden ser migrados entre instancias de Appwrite.

A diferencia de un backup físico (volúmenes Docker), esta herramienta exporta los datos a nivel de aplicación, permitiendo:

- Migrar proyectos entre servidores
- Versionar la estructura de la base de datos
- Mantener backups portátiles entre entornos dev/staging/prod
- Restaurar proyectos en una nueva instancia de Appwrite

## Características principales

### Exportación (Backup)

- **Módulos exportables**: Auth (usuarios, equipos, membresías), Databases (esquema + documentos), Storage (buckets + archivos)
- **Manifest central**: Archivo `manifest.json` con metadatos, timestamps, checksums SHA-256 y estado de cada módulo
- **Integridad verificable**: Cada archivo exportado incluye su checksum SHA-256
- **Datos sensibles protegidos**: Contraseñas, hashes y credenciales son redactados automáticamente
- **Logging**: Archivo NDJSON de log por cada backup en `logs/export.log`

### Importación (Restore)

- **Orden garantizado**: Auth → Databases (esquema primero, documentos después) → Storage
- **Remapeo automático de IDs**: Los IDs fuente se mapean a IDs destino para mantener referencias
- **Detección de duplicados**: Manejo inteligente de usuarios y recursos existentes
- **Progreso en tiempo real**: Actualizaciones vía Server-Sent Events (SSE)

### Backups Programados

- **Scheduling con cron**: Programar ejecuciones automáticas usando expresiones cron
- **Gestión completa**: Crear, editar, eliminar y ejecutar manualmente schedules
- **Historial de ejecuciones**: Registro de cada ejecución con estado, duración y errores
- **Bloqueo de concurrencia**: Evita ejecuciones simultáneas del mismo schedule

### Gestión de Backups

- **Catálogo completo**: Listar todos los backups con progreso y estado
- **Validación exhaustiva**: Verificar checksums, estructura, esquema y referencias cruzadas
- **Descarga**: Exportar backups como archivos `.tar.gz`
- **Eliminación segura**: Proceso de dos pasos con confirmación

### Panel Web

- **Dashboard intuitivo**: Interfaz en español con pestañas Exportar / Programar / Importar
- **Progreso en tiempo real**: Barras de progreso y fases durante exportación/importación
- **Métricas**: Conteo de backups, documentos, archivos y checksums
- **Historial**: Último backup con estado por módulo e historial completo

### CLI

La herramienta también incluye una interfaz de línea de comandos:

```bash
npm run cli -- inspect                           # Inspeccionar el proyecto
npm run cli -- export all                        # Exportar todos los módulos
npm run cli -- export databases                  # Exportar un módulo específico
npm run cli -- validate ./backups/backup-xxx     # Validar un backup
npm run cli -- import all --backup ./backups/backup-xxx  # Importar un backup
npm run cli -- delete backup-xxx --confirm       # Eliminar un backup
```

## Tecnologías utilizadas

| Capa | Tecnología |
|------|------------|
| Framework | Next.js 16 |
| UI | React 19 |
| Lenguaje | TypeScript (modo estricto) |
| Estilos | Tailwind CSS v4 |
| SDK Appwrite | node-appwrite (Server SDK) |
| Validación | Zod |
| CLI | Commander |
| Programación | croner |
| Logging | pino |
| Testing | Vitest |
| Contenedorización | Docker + Docker Compose |

## Instalación

### Desarrollo local

```bash
# 1. Clonar el repositorio
git clone https://github.com/tu-usuario/appwrite-export-toolkit.git
cd appwrite-export-toolkit

# 2. Instalar dependencias
npm install

# 3. Configurar variables de entorno
cp .env.example .env
# Editar .env con tus credenciales de Appwrite

# 4. Ejecutar el servidor de desarrollo
npm run dev
```

### Docker

```bash
# Construir y ejecutar
docker compose up --build

# Acceder en http://localhost:3000
```

El `docker-compose.yml` incluido monta un volumen persistente en `/data` para que los backups sobrevivan reinicios:

```yaml
services:
  appwrite-export-toolkit:
    build: .
    ports:
      - "3000:3000"
    environment:
      BACKUP_OUTPUT_DIR: "/data/backups"
    volumes:
      - appwrite-export-toolkit-data:/data
    restart: unless-stopped

volumes:
  appwrite-export-toolkit-data:
```

### Despliegue en producción

1. Usar el `Dockerfile` incluido (build multi-etapa)
2. Exponer puerto `3000`
3. Montar volumen persistente en `/data` (ya incluido en `docker-compose.yml`)
4. Los backups se escribirán en `/data/backups`

Plataformas compatibles: EasyPanel, Dokploy, cualquier plataforma que soporte Dockerfiles.

## Variables de entorno

### Requeridas (Proyecto fuente)

| Variable | Descripción | Ejemplo |
|----------|-------------|---------|
| `APPWRITE_ENDPOINT` | Endpoint de la API de Appwrite | `https://tu-appwrite.ejemplo.com/v1` |
| `APPWRITE_PROJECT_ID` | ID del proyecto a exportar | `tu_project_id` |
| `APPWRITE_API_KEY` | API key con los permisos necesarios | `standard_...` |
| `BACKUP_OUTPUT_DIR` | Directorio donde se escriben los backups | `/data/backups` (producción) o `./backups` (desarrollo) |
| `BACKUP_FORMAT_VERSION` | Versión del formato de backup | `1.0.0` |

### Opcionales (Proyecto destino para importar)

| Variable | Descripción |
|----------|-------------|
| `APPWRITE_TARGET_ENDPOINT` | Endpoint de Appwrite destino |
| `APPWRITE_TARGET_PROJECT_ID` | ID del proyecto destino |
| `APPWRITE_TARGET_API_KEY` | API key del proyecto destino |

### Opcionales (Interfaz web)

| Variable | Valor por defecto | Descripción |
|----------|-------------------|-------------|
| `APP_LOGIN_USER` | `admin` | Usuario del panel web |
| `APP_LOGIN_PASSWORD` | `change-me-now` | Contraseña del panel web |

> **⚠️ Seguridad:** Estas credenciales por defecto son solo para desarrollo. **En producción es obligatorio cambiarlas** antes de desplegar. Si se dejan por defecto, cualquier persona puede acceder al panel.

### Build

| Variable | Valor por defecto | Descripción |
|----------|-------------------|-------------|
| `NIXPACKS_NODE_VERSION` | `22` | Versión de Node.js para el build (usado por Dokploy/Nixpacks) |

### Seguridad

| Variable | Valor por defecto | Descripción |
|----------|-------------------|-------------|
| `APP_CSRF_SECRET` | - | **Requerido.** Secreto para tokens CSRF. Generar con: `openssl rand -hex 32` |

### Runtime

| Variable | Valor por defecto | Descripción |
|----------|-------------------|-------------|
| `LOG_LEVEL` | `info` | Nivel de log de pino |
| `SCHEDULER_DISABLED` | - | Establecer en `1` para deshabilitar el programador de cron |
| `COOKIE_SECURE` | `0` | Establecer en `1` si el sitio usa HTTPS (cookie `Secure` flag) |

## Estructura del proyecto

```
appwrite-export-toolkit/
+-- src/
|   +-- app/                        # Next.js App Router
|   |   +-- page.tsx                # Login + dashboard (SPA)
|   |   +-- layout.tsx              # Layout raiz
|   |   +-- api/
|   |       +-- export/route.ts     # POST (SSE) + GET jobs
|   |       +-- import/route.ts     # POST (SSE) + GET jobs
|   |       +-- backups/            # GET list, POST download
|   |       +-- schedules/          # CRUD + POST run
|   |       +-- jobs/               # GET status + GET stream (SSE)
|   |       +-- health/route.ts     # GET health check
|   +-- components/                 # React client components
|   |   +-- export-panel.tsx        # Panel de exportacion con SSE
|   |   +-- import-panel.tsx        # Panel de importacion con SSE
|   |   +-- schedules-panel.tsx     # Gestion de schedules
|   |   +-- schedule-card.tsx       # Card individual de schedule
|   |   +-- schedule-form-dialog.tsx# Formulario crear/editar
|   |   +-- progress-bar.tsx        # Barra de progreso SSE
|   |   +-- backup-warnings.tsx     # Warnings de backups
|   +-- cli/index.ts                # CLI con Commander (5 comandos)
|   +-- server/
|       +-- exporters/              # auth, database, storage (functions/messaging planificados)
|       +-- import/                 # orchestrator, progress-store, id-remapper
|       |   +-- modules/            # auth, database, storage (functions/messaging planificados)
|       +-- backup/                 # backup-writer, checksum-service, paths, ndjson-writer
|       +-- backups/                # catalog, delete-catalog, storage (list/delete/download)
|       +-- schedules/              # scheduler-engine (cron), lock, running-jobs, schedule-runner
|       +-- jobs/                   # job-streamer (SSE)
|       +-- validators/             # backup-validator (integridad)
|       +-- inspectors/             # project-inspector
|       +-- auth/                   # session, csrf (HMAC stateless)
|       +-- appwrite/               # client, config, http-download
|       +-- manifest/               # manifest-service
|       +-- utils/                  # logger, pagination, retry, json
|       +-- types/                  # backup, export-result
+-- docs/                           # 8 guias detalladas
+-- public/                         # Logos
+-- Dockerfile                      # Build multi-etapa
+-- docker-compose.yml              # Volumen persistente en /data
+-- .env.example                    # Plantilla de variables
```

## Orden de restauración

El orden de restauración es crítico y está garantizado por el orquestador:

1. **Auth** - Usuarios, equipos y membresías
2. **Databases** - Esquema primero (colecciones, atributos, índices), documentos después
3. **Storage** - Buckets y archivos

Esto es importante porque:
- Los documentos pueden contener permisos `user:<id>`
- Las filas de base de datos pueden referenciar IDs de archivos en Storage

> **Nota:** Functions y Messaging tienen exportadores/importadores implementados pero aún no están conectados al orquestador. Actualmente solo se exportan/importan los 3 módulos listados arriba.

## Comandos de calidad

```bash
npm run lint          # Verificación ESLint
npm run typecheck     # TypeScript --noEmit
npm run test          # Ejecutar tests con Vitest
npm run build         # Build de Next.js
npm run check         # Los tres anteriores combinados
```

## Documentación

La documentación detallada se encuentra en el directorio [`docs/`](https://github.com/mauricioandre10-ctrl/Appwrite-Export-Toolkit/tree/main/docs):

| Documento | Descripción |
|-----------|-------------|
| [Arquitectura](docs/ARQUITECTURA.md) | Arquitectura general del sistema |
| [Referencia API](docs/API_REFERENCE.md) | Documentación completa de la API |
| [Referencia CLI](docs/CLI_REFERENCE.md) | Guía de uso de la línea de comandos |
| [Formato de Backup](docs/FORMATO_BACKUP.md) | Estructura y formato de los archivos de backup |
| [Programación](docs/PROGRAMACION.md) | Uso del programador de backups con cron |
| [Seguridad](docs/SEGURIDAD.md) | Patrones y prácticas de seguridad |
| [Desarrollo](docs/DESARROLLO.md) | Guía para contribuir al proyecto |
| [Agregar Módulos](docs/AGREGAR_MODULOS.md) | Cómo extender la herramienta con nuevos módulos |

## API

| Método | Ruta | Descripción |
|--------|------|-------------|
| `POST` | `/api/export` | Exportar módulos del proyecto (SSE) |
| `POST` | `/api/import` | Importar un backup a un proyecto (SSE) |
| `GET` | `/api/backups/[backupId]/download` | Descargar un backup como `.tar.gz` |
| `GET` | `/api/schedules` | Listar todos los schedules configurados |
| `POST` | `/api/schedules` | Crear un nuevo schedule |
| `GET` | `/api/schedules/[id]` | Obtener detalles de un schedule |
| `PUT` | `/api/schedules/[id]` | Actualizar un schedule |
| `DELETE` | `/api/schedules/[id]` | Eliminar un schedule |
| `POST` | `/api/schedules/[id]/run` | Ejecutar un schedule manualmente |
| `GET` | `/api/jobs/[jobId]` | Consultar estado de un job |
| `GET` | `/api/jobs/[jobId]/stream` | Stream SSE de progreso de un job |
| `GET` | `/api/health` | Health check del servidor |

## Licencia

Este software es de código abierto bajo la licencia **GNU GPLv3**.

Creado por **Mauricio Sanchez** como proyecto puramente educativo.

## Contribuir

Las contribuciones son bienvenidas. Por favor, abre un issue o pull request en el repositorio.

## Soporte

Si encuentras algún problema, abre un issue en GitHub con:
- Descripción del problema
- Pasos para reproducir
- Logs relevantes (sin exponer credenciales)
- Versión de Appwrite y Node.js
