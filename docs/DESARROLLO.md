# Guia de Desarrollo

## Prerequisitos

- **Node.js 20+** (recomendado 22, como indica `.env.example`)
- **npm 10+**
- Una instancia de **Appwrite** funcionando (cloud o self-hosted)
- (Opcional) Segunda instancia de Appwrite para probar imports

## Setup local

```bash
git clone <repo-url>
cd appwrite-export-toolkit
npm install
cp .env.example .env
```

Edita el `.env` con tus credenciales reales:

```env
APPWRITE_ENDPOINT="https://cloud.appwrite.io/v1"
APPWRITE_PROJECT_ID="tu-project-id"
APPWRITE_API_KEY="tu-api-key"

APP_LOGIN_USER="admin"
APP_LOGIN_PASSWORD="cambiar-esto"
```

Levantar en desarrollo:

```bash
npm run dev
```

La app queda en `http://localhost:3000`.

## Testing

```bash
npm run test          # ejecuta una vez
npm run test:watch    # modo watch para desarrollo
```

Tests con Vitest. Los archivos de test siguen la convencion `*.test.ts` junto al modulo que testean.

## Linting y typecheck

```bash
npm run check   # lint + typecheck + test en secuencia
npm run lint    # solo eslint
npm run typecheck  # solo tsc --noEmit
```

Corre `npm run check` antes de commitear. Si falla, arreglalo antes de hacer push.

## Estructura del proyecto

```
src/
  app/                    # Next.js App Router
    page.tsx              # Pagina principal (login + dashboard)
    layout.tsx            # Layout raiz
    csrf-token.tsx        # Componente server para CSRF meta tag
    loading-button.tsx    # Boton con estado de carga
    password-input.tsx    # Input de password con toggle
    api/                  # API routes
      export/             # POST /api/export
      import/             # POST /api/import
      backups/            # Descarga y eliminacion de backups
      jobs/               # SSE para progreso en tiempo real
      schedules/          # CRUD de schedules
      health/             # Health check

  components/             # Componentes React
    export-panel.tsx      # Panel de exportacion
    import-panel.tsx      # Panel de importacion
    schedules-panel.tsx   # Panel de schedules
    schedule-card.tsx     # Card individual de schedule
    schedule-form-dialog.tsx
    progress-bar.tsx
    backup-warnings.tsx

  server/                 # Logica server-side
    appwrite/             # Cliente y config de Appwrite
      client.ts           # createAppwriteServices()
      config.ts           # loadAppwriteConfig(), loadTargetConfig()
    auth/                 # Autenticacion
      session.ts          # Tokens de sesion HMAC
      csrf.ts             # Proteccion CSRF stateless
    exporters/            # Modulos de exportacion
      export-orchestrator.ts  # Coordinador principal
      auth-exporter.ts
      database-exporter.ts
      storage-exporter.ts
      functions-exporter.ts
      messaging-exporter.ts
      types.ts
      sanitize.ts
    import/               # Modulos de importacion
      import-orchestrator.ts  # Coordinador de import
      id-remapper.ts      # Mapeo automatico de IDs
      progress-store.ts   # Estado de jobs
      modules/
        auth-importer.ts
        database-importer.ts
        storage-importer.ts
        functions-importer.ts
        messaging-importer.ts
        schema-restorer.ts
    schedules/            # Sistema de cron
      scheduler-engine.ts # Motor basado en croner
      schedule-runner.ts  # Bridge scheduler -> export-orchestrator
      storage.ts          # Persistencia en archivos JSON
      lock.ts             # Lock basado en mkdir
      running-jobs.ts     # Jobs en ejecucion (in-memory)
      types.ts            # Schemas Zod
    backup/               # Escritura de backups
      backup-writer.ts    # Escritor de archivos
      checksums.ts        # SHA256 de archivos
      paths.ts            # Resolucion de paths
      export-job-logger.ts
    backups/              # Catalogo de backups existentes
      catalog.ts          # Listado y metadata
      delete-catalog.ts   # Eliminacion
    jobs/                 # Sistema de jobs
    types/                # Tipos compartidos
    utils/                # Utilidades
      logger.ts           # Pino logger
      json.ts             # Serializacion JSON/NDJSON
      pagination.ts       # Paginacion de API
      retry.ts            # Reintentos
    validators/           # Validacion de backups
    manifest/             # Manifest de backups
    inspectors/           # Inspeccion de contenido

  cli/                    # CLI independiente
```

## Patrones clave

### Server Components vs Client Components

- **Server Components** (default): toda pagina y layout en `src/app/` corre en el servidor. Acceden directamente a DB, filesystem, variables de entorno.
- **Client Components**: archivos con `"use client"` al inicio. Usados para interactividad (formularios, dialogs, polling SSE). Ejemplo: `schedule-card.tsx`, `export-panel.tsx`.

### Server Actions

Funciones con `"use server"` en su interior. Se definen en el mismo archivo que las paginas (como `page.tsx`) o en archivos separados. Se invocan desde `<form action={...}>`. Ejemplo:

```typescript
async function loginAction(formData: FormData) {
  "use server";
  // logica de login
  redirect("/");
}
```

### API Routes

Archivos en `src/app/api/*/route.ts`. Se usan para endpoints que el cliente llama con `fetch`, como SSE para progreso en tiempo real o descarga de archivos.

### NDJSON para datos grandes

Los exports usan formato NDJSON (una linea JSON por registro) en vez de un JSON array completo. Esto permite:
- Streaming de archivos grandes sin cargar todo en memoria
- Procesar registro por registro durante el import
- Archivos que pueden ser leidos line-by-line

```typescript
// Escritura con stream
await writer.writeNdjsonStream("auth/users.ndjson", async (append) => {
  for await (const page of paginateRows("users", (queries) => services.users.list(queries))) {
    for (const user of page.rows) {
      await append(user);
    }
  }
});
```

## Como funciona el .env

El archivo `.env` se carga con `dotenv/config` al importar `src/server/appwrite/config.ts`. Las variables se validan con Zod:

- **Source** (`APPWRITE_*`): configuracion del proyecto Appwrite origen (de donde se exporta)
- **Target** (`APPWRITE_TARGET_*`): configuracion del proyecto destino (a donde se importa). Solo necesaria para imports.
- **BACKUP_OUTPUT_DIR**: directorio donde se guardan los backups. En produccion usa un volumen persistente, en desarrollo fallback a `.data/backups` o `os.tmpdir()`.
- **APP_LOGIN_USER / APP_LOGIN_PASSWORD**: credenciales del panel web. Se usan para generar el token de sesion HMAC.

La funcion `loadTargetConfig()` swapea las credenciales target sobre las source, asi el mismo Codigo de import usa la misma interfaz.

## Almacenamiento de datos

El directorio `.data/` contiene datos persistidos entre reinicios:

```
.data/
  .jobs/          # Estado de jobs de export/import (JSON por job)
  .schedules/     # Schedules configurados (JSON por schedule)
  .schedules/     # Directorio de locks (carpetas .lock)
```

Los schedules se resuelven con este orden de preferencia:
1. `BACKUP_OUTPUT_DIR/.schedules/`
2. `/data/.schedules/`
3. `<project-root>/.data/.schedules/`
4. `os.tmpdir()/.schedules/` (ultima opcion)

## Estilo de codigo

- **TypeScript strict mode**: `tsconfig.json` con `"strict": true`
- **Zod para validacion**: todos los schemas de entrada usan Zod (schemas de schedules, config de Appwrite, etc.)
- **Pino para logging**: logger configurado en `src/server/utils/logger.ts` con redaccion automatica de API keys
- **NDJSON para datos grandes**: archivos de export en formato linea-por-linea
- **Sin comentarios**: el Codigo es autoexplicativo. Solo documentar decisiones de negocio no obvias.
