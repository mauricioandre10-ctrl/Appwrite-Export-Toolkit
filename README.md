# Appwrite Export Toolkit

Herramienta de exportación estructuración, validación y restauración de backups lógicos para proyectos Appwrite self-hosted.

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
# Inspeccionar el proyecto configurado
npm run cli -- inspect

# Exportar todos los módulos
npm run cli -- export all

# Exportar un módulo específico
npm run cli -- export databases

# Validar un backup existente
npm run cli -- validate ./backups/backup-xxx

# Importar un backup
npm run cli -- import all --backup ./backups/backup-xxx

# Eliminar un backup
npm run cli -- delete backup-xxx --confirm
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

### Despliegue en producción

1. Usar el `Dockerfile` incluido (build multi-etapa)
2. Exponer puerto `3000`
3. Montar volumen persistente en `/data`
4. Los backups se escribirán en `/data/backups`

Plataformas compatibles: EasyPanel, Docploy, cualquier plataforma que soporte Dockerfiles.

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

### Opcionales (Runtime)

| Variable | Valor por defecto | Descripción |
|----------|-------------------|-------------|
| `LOG_LEVEL` | `info` | Nivel de log de pino |
| `SCHEDULER_DISABLED` | - | Establecer en `1` para deshabilitar el programador de cron |

## Estructura del proyecto

```
appwrite-export-toolkit/
├── src/
│   ├── app/                    # Páginas Next.js App Router
│   │   ├── page.tsx            # Página principal (login + dashboard)
│   │   ├── layout.tsx          # Layout raíz con metadata
│   │   └── api/                # Rutas API
│   │       ├── export/         # POST /api/export
│   │       ├── import/         # POST /api/import
│   │       ├── schedules/      # CRUD de schedules
│   │       ├── backups/        # Gestión de backups
│   │       └── health/         # Health check
│   ├── components/             # Componentes React client
│   ├── cli/                    # Interfaz de línea de comandos
│   └── server/                 # Lógica del servidor
│       ├── exporters/          # Módulos de exportación
│       ├── import/             # Módulos de importación
│       ├── backup/             # Escritura y checksums
│       ├── schedules/          # Programación de backups
│       └── validators/         # Validación de backups
├── public/                     # Assets estáticos (logos)
├── Dockerfile                  # Build multi-etapa para Docker
├── docker-compose.yml          # Configuración Docker Compose
└── .env.example                # Plantilla de variables de entorno
```

## Orden de restauración

El orden de restauración es crítico y está garantizado por el orquestador:

1. **Auth** - Usuarios, equipos y membresías
2. **Databases** - Esquema primero (colecciones, atributos, índices), documentos después
3. **Storage** - Buckets y archivos

Esto es importante porque:
- Los documentos pueden contener permisos `user:<id>`
- Las filas de base de datos pueden referenciar IDs de archivos en Storage
- Las funciones pueden depender de bases de datos y credenciales

## Comandos de calidad

```bash
npm run lint          # Verificación ESLint
npm run typecheck     # TypeScript --noEmit
npm run test          # Ejecutar tests con Vitest
npm run build         # Build de Next.js
npm run check         # Los tres anteriores combinados
```

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
