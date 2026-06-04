# Arquitectura del Appwrite Export Toolkit

## Visión general

El toolkit es una aplicación Next.js que sirve para exportar, validar e importar datos de instancias Appwrite self-hosted. Tiene dos formas de usarse: una interfaz web y una CLI.

La idea principal es simple: conectás a tu Appwrite de origen, exportás todo a archivos JSON/NDJSON en tu disco, y después podés importar esos archivos a otra instancia de Appwrite.

## Componentes principales

```
┌─────────────────────────────────────────────────────┐
│                   INTERFAZ                          │
│  ┌──────────────┐  ┌──────────────┐  ┌───────────┐ │
│  │   Web UI     │  │     CLI      │  │  API REST │ │
│  │  (React)     │  │ (commander)  │  │ (routes)  │ │
│  └──────┬───────┘  └──────┬───────┘  └─────┬─────┘ │
│         │                 │                │        │
│  ┌──────┴─────────────────┴────────────────┴─────┐  │
│  │            ORQUESTADORES                       │  │
│  │  export-orchestrator.ts                        │  │
│  │  import-orchestrator.ts                        │  │
│  └────────────────────┬───────────────────────────┘  │
│                       │                              │
│  ┌────────────────────┴───────────────────────────┐  │
│  │         EXPORTADORES / IMPORTADORES            │  │
│  │  auth-exporter    │  auth-importer             │  │
│  │  database-exporter│  database-importer         │  │
│  │  storage-exporter │  storage-importer          │  │
│  │                   │  functions-importer        │  │
│  │                   │  messaging-importer        │  │
│  │                   │  schema-restorer           │  │
│  └────────────────────┬───────────────────────────┘  │
│                       │                              │
│  ┌────────────────────┴───────────────────────────┐  │
│  │              SERVICIOS                         │  │
│  │  appwrite client  │  backup-writer             │  │
│  │  checksum-service │  progress-store            │  │
│  │  scheduler-engine │  catalog                   │  │
│  └────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────┘
```

## Flujo de Export

1. El usuario elige qué módulos exportar (all, auth, databases, storage)
2. Se crea un job en `progress-store` para trackear el progreso
3. `export-orchestrator` coordina la exportación en orden: auth → databases → storage
4. Cada exporter conecta a Appwrite vía SDK, recorre los recursos y los escribe como JSON/NDJSON
5. `backup-writer` crea la estructura de directorios y escribe los archivos
6. Se genera un `manifest.json` con checksums y metadata
7. Se calcula un SHA256 por cada archivo para verificación de integridad
8. El resultado se guarda en `BACKUP_OUTPUT_DIR`

### Orden de exportación

El orden importa porque hay dependencias. Auth se exporta primero porque las referencias de usuario se usan en databases y storage. Si exportás en otro orden, los IDs de referencia no van a estar disponibles.

## Flujo de Import

1. El usuario elige un backup y qué módulos importar
2. Se lee el `manifest.json` para saber qué hay en el backup
3. `import-orchestrator` coordina la importación en orden: auth → databases → storage
4. Cada importer lee los archivos JSON/NDJSON del backup
5. `schema-restorer` recrea la estructura de Appwrite (colecciones, atributos, índices)
6. Los IDs se remapean con `IdRemapper` para no colisionar con datos existentes
7. Los documentos se insertan en orden respetando referencias
8. `progress-store` actualiza el progreso que se envía vía SSE al cliente

### Remapeo de IDs

Cuando importás a un proyecto que ya tiene datos, los IDs del backup pueden colisionar con los existentes. El `IdRemapper` genera nuevos IDs y mapea las referencias. Por ejemplo, si un documento tiene `"userId": "abc123"` y ese usuario se creó con un nuevo ID `"def456"`, el remapper cambia la referencia automáticamente.

## Motor de Cron (Schedules)

El sistema de schedules usa `croner` para parsing de expresiones cron. La arquitectura es:

```
scheduler-engine (en memoria)  →  storage (archivos JSON en disco)
         │                              │
         └──── register / unregister ───┘
```

- `scheduler-engine`: Maneja el registro de cron jobs y ejecuta callbacks cuando toca
- `storage`: Persiste los schedules como archivos JSON individuales
- `schedule-runner`: Conecta el scheduler con el export-orchestrator
- `lock.ts`: Evita que un schedule se ejecute dos veces simultáneamente

Los schedules se persisten en `.data/.schedules/` como archivos JSON. Cada schedule tiene su propio archivo.

## Almacenamiento de Backups

La estructura de un backup en disco es:

```
BACKUP_OUTPUT_DIR/
  backup-YYYY-MM-DDTHH-MM-SSZ/
    manifest.json          ← Metadata general, checksums, conteos
    checksums.sha256       ← SHA256 de cada archivo
    export.log             ← Log detallado de la exportación
    auth/
      users.ndjson         ← Un usuario por línea
      teams.ndjson
      memberships.ndjson
    databases/
      databases.json       ← Lista de databases
      collections/
        db_xxx.json        ← Cada database tiene su archivo
      documents/
        col_xxx.ndjson     ← Un documento por línea
    storage/
      buckets.json
      files.json           ← Metadata de cada archivo
      blobs/               ← Los archivos binarios reales
    functions/
      function_xxx/        ← Directorio por función
        meta.json
        code/
        variables.json
    messaging/
      providers.json
      topics.ndjson
```

Usamos NDJSON (un JSON por línea) para archivos grandes porque permite:
- Leer línea por línea sin cargar todo en memoria
- Parsear archivos parcialmente corruptos sin perder todos los datos
- Hacer streaming de datos enormes

## Sistema de Jobs y SSE

Cuando iniciás un export o import desde la web, el flujo es:

1. El cliente hace POST a `/api/export` o `/api/import`
2. El server crea un job y devuelve un `jobId`
3. El cliente se suscribe a `/api/jobs/{jobId}/stream` (SSE)
4. El server envía eventos `progress` con porcentaje, fase y módulo
5. Cuando termina, envía `complete` con el resultado
6. Si falla, envía `error-event`

Los jobs se persisten como archivos JSON en `.data/jobs/`. El streaming usa `ReadableStream` de Web API.

## Seguridad

- **Sesión**: Cookie con token HMAC. Validación con `timingSafeEqual`
- **CSRF**: Token stateless (HMAC de sesión + timestamp). Se pasa por `<meta>` tag y hidden input
- **Headers de seguridad**: CSP, X-Frame-Options, HSTS, etc.
- **Protección de paths**: Validación de `..` y `/` en nombres de backup
- **Sanitización de errores**: Los mensajes de error no exponen rutas del servidor

## Dependencias principales

| Paquete | Para qué |
|---------|----------|
| `next` 16 | Framework web |
| `node-appwrite` | SDK de Appwrite |
| `croner` | Parsing de expressions cron |
| `zod` | Validación de schemas |
| `pino` | Logging estructurado |
| `tar` | Empaquetado de backups |
| `commander` | CLI |
