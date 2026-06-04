# Formato de Backup

Esta documentación describe la estructura de archivos que genera el toolkit cuando exportás datos de Appwrite.

## Estructura de directorios

```
backup-YYYY-MM-DDTHH-MM-SSZ/
+-- manifest.json
+-- checksums.sha256
+-- export.log
+-- auth/
|   +-- users.ndjson
|   +-- teams.ndjson
|   +-- memberships.ndjson
+-- databases/
|   +-- databases.json
|   +-- collections/
|   |   +-- db_default.json
|   |   +-- db_xxxxx.json
|   +-- documents/
|       +-- col_xxxxx.ndjson
|       +-- col_yyyyy.ndjson
+-- storage/
|   +-- buckets.json
|   +-- files.json
|   +-- blobs/
|       +-- bucket_xxx/
|           +-- file_id
+-- functions/
|   +-- function_xxx/
|       +-- meta.json
|       +-- code/
|       |   +-- (archivos del bundle)
|       +-- variables.json
+-- messaging/
    +-- providers.json
    +-- topics.ndjson
```

## manifest.json

El manifest es el archivo principal que describe qué contiene el backup.

```json
{
  "version": "1.0",
  "exportedAt": "2026-01-15T10:30:00.000Z",
  "projectId": "65f1a2b3c4d5e6f7a8b9c0d1",
  "modules": ["auth", "databases", "storage"],
  "restoreOrder": ["auth", "databases", "storage"],
  "counts": {
    "users": 150,
    "teams": 12,
    "databases": 5,
    "collections": 23,
    "documents": 4500,
    "buckets": 3,
    "files": 280,
    "functions": 8
  },
  "checksums": {
    "auth/users.ndjson": "a1b2c3d4...",
    "databases/databases.json": "e5f6g7h8...",
    "...": "..."
  },
  "moduleStatus": {
    "auth": "complete",
    "databases": "partial",
    "storage": "complete"
  },
  "warnings": []
}
```

### Campos del manifest

| Campo | Tipo | Descripción |
|-------|------|-------------|
| `version` | string | Versión del formato (actualmente "1.0") |
| `exportedAt` | string (ISO 8601) | Fecha y hora de la exportación |
| `projectId` | string | ID del proyecto Appwrite de origen |
| `modules` | string[] | Módulos que fueron exportados |
| `restoreOrder` | string[] | Orden en que se deben restaurar los módulos |
| `counts` | object | Cantidad de recursos exportados por tipo |
| `checksums` | object | SHA256 de cada archivo del backup |
| `moduleStatus` | object | Estado de cada módulo ("complete", "partial", "failed") |
| `warnings` | string[] | Advertencias durante la exportación |

## Formatos de archivo

### JSON normal

Se usa para archivos pequeños o que necesitan ser leídos completos:
- `databases.json` — Lista de databases
- `buckets.json` — Lista de buckets
- `files.json` — Metadata de archivos de storage
- `meta.json` — Metadata de functions
- `variables.json` — Variables de environment de functions
- `providers.json` — Providers de messaging
- `manifest.json` — Ya explicado arriba

### NDJSON (Newline Delimited JSON)

Se usa para archivos grandes donde conviene leer por partes:
- `users.ndjson` — Un usuario por línea
- `teams.ndjson` — Un team por línea
- `memberships.ndjson` — Una membership por línea
- `col_xxx.ndjson` — Documentos de una colección, uno por línea
- `topics.ndjson` — Topics de messaging, uno por línea

Cada línea es un JSON válido independiente. Ejemplo de `users.ndjson`:

```
{"$id":"user1","name":"John","email":"john@example.com","status":"confirmed","$createdAt":"2024-01-01T00:00:00.000Z"}
{"$id":"user2","name":"Jane","email":"jane@example.com","status":"confirmed","$createdAt":"2024-01-02T00:00:00.000Z"}
```

## checksums.sha256

Archivo con el formato estándar de sha256sum:

```
a1b2c3d4e5f6...  auth/users.ndjson
e5f6g7h8i9j0...  databases/databases.json
k1l2m3n4o5p6...  databases/documents/col_xxx.ndjson
```

Se genera con `sha256File()` de `checksum-service.ts` y se valida durante la importación.

## export.log

Log detallado de la exportación. Cada línea es un objeto JSON con timestamp, nivel y mensaje. Se usa para debugging cuando algo falla durante la export.

## Protección contra path traversal

Los nombres de backup se validan para prevenir ataques de path traversal. Solo se permiten caracteres alfanuméricos, guiones, guiones bajos y puntos. Se rechazan nombres con `..`, `/` o `\`.

La validación está en `src/server/backup/paths.ts`:
- `resolveBackupRoot()` — Valida que el directorio raíz sea seguro
- `isSafeBackupId()` — Valida que el ID del backup no tenga caracteres peligrosos
