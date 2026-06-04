# Referencia de la API REST

Todos los endpoints requieren autenticación (cookie de sesión) excepto `/api/health`. Los endpoints mutantes (POST, PATCH, DELETE) también requieren un token CSRF.

## Autenticación

Las peticiones deben incluir la cookie `appwrite_export_toolkit_session` con un token de sesión válido. Si no estás autenticado, todos los endpoints (excepto health) devuelven 401.

## CSRF

Los endpoints que modifican datos necesitan un token CSRF. Se puede enviar de dos formas:

- **Form data**: Campo oculto `csrf_token` en el body
- **Header**: `x-csrf-token` con el valor del token

El token se genera automáticamente en el server y se pasa al cliente via `<meta>` tag.

---

## Endpoints

### POST /api/export

Crea un job de exportación. El export corre en background.

**Body:**
```json
{
  "module": "all"    // Opcional: "all", "auth", "databases", "storage"
}
```

**Respuesta 200:**
```json
{
  "jobId": "export_2026-01-15T10-30-00Z_databases",
  "module": "databases"
}
```

Usá el `jobId` para suscribirte al stream de progreso.

---

### POST /api/import

Crea un job de importación desde un backup existente.

**Body:**
```json
{
  "backupId": "backup-2026-01-15T10-30-00Z",  // Requerido
  "module": "all"                              // Opcional
}
```

**Respuesta 200:**
```json
{
  "jobId": "import_2026-01-15T10-30-00Z_all",
  "backupId": "backup-2026-01-15T10-30-00Z",
  "module": "all"
}
```

---

### GET /api/schedules

Lista todos los schedules configurados.

**Respuesta 200:**
```json
{
  "schedules": [
    {
      "id": "sch_abc123",
      "name": "Backup diario",
      "cronExpression": "0 2 * * *",
      "timezone": "America/Argentina/Buenos_Aires",
      "module": "all",
      "target": "source",
      "enabled": true,
      "createdAt": "2026-01-10T00:00:00.000Z",
      "updatedAt": "2026-01-10T00:00:00.000Z",
      "lastRunAt": "2026-01-15T02:00:00.000Z",
      "lastRunStatus": "success",
      "lastRunJobId": "export_2026-01-15T02-00-00Z_all",
      "nextRunAt": "2026-01-16T02:00:00.000Z",
      "currentRunJobId": null
    }
  ]
}
```

---

### POST /api/schedules

Crea un nuevo schedule.

**Body:**
```json
{
  "name": "Backup diario",
  "cronExpression": "0 2 * * *",
  "timezone": "America/Argentina/Buenos_Aires",
  "module": "all",           // Opcional, default "all"
  "target": "source",        // Opcional, default "source"
  "enabled": true            // Opcional, default true
}
```

**Respuesta 201:** El schedule creado con su `id` y `nextRunAt`.

---

### PATCH /api/schedules/[id]

Actualiza parcialmente un schedule existente. Todos los campos son opcionales.

**Body (ejemplo):**
```json
{
  "cronExpression": "0 3 * * *",
  "enabled": false
}
```

**Respuesta 200:** El schedule completo actualizado.

---

### DELETE /api/schedules/[id]

Elimina un schedule permanentemente.

**Respuesta 200:**
```json
{ "success": true }
```

---

### POST /api/schedules/[id]/run

Ejecuta un schedule manualmente (no espera al cron).

**Respuesta 202:**
```json
{
  "status": "triggered",
  "scheduleId": "sch_abc123",
  "jobId": "export_2026-01-15T10-30-00Z_all",
  "message": "Ejecución iniciada"
}
```

Si el schedule ya está ejecutándose, devuelve 409.

---

### GET /api/jobs/[jobId]

Devuelve el estado actual de un job (para polling).

**Respuesta 200:**
```json
{
  "jobId": "export_2026-01-15T10-30-00Z_all",
  "type": "export",
  "status": "running",
  "percent": 45,
  "phase": "exporting",
  "module": "databases",
  "detail": "",
  "startedAt": "2026-01-15T10:30:00.000Z",
  "finishedAt": "",
  "result": null,
  "error": undefined
}
```

Valores posibles de `status`: `pending`, `running`, `completed`, `failed`.

---

### GET /api/jobs/[jobId]/stream

Abre una conexión SSE que emite eventos de progreso en tiempo real.

**Eventos:**

| Evento | Datos | Cuándo |
|--------|-------|--------|
| `progress` | `{ jobId, percent, phase, module, detail }` | Durante la ejecución |
| `complete` | `{ jobId, status, redirectUrl }` | Cuando termina |
| `error-event` | `{ jobId, error }` | Si falla |

**Ejemplo de stream:**
```
event: progress
data: {"jobId":"export_...","percent":30,"phase":"exporting","module":"databases","detail":""}

event: progress
data: {"jobId":"export_...","percent":75,"phase":"checksums","module":"storage","detail":""}

event: complete
data: {"jobId":"export_...","status":"completed","redirectUrl":"/?exported=backup-xxx"}
```

---

### POST /api/backups/[backupId]/download

Descarga un backup completo como archivo `.tar.gz`.

**Respuesta 200:** Stream binario con headers:
- `Content-Type: application/gzip`
- `Content-Disposition: attachment; filename="backup-xxx.tar.gz"`

---

### GET /api/health

Health check sin autenticación.

**Respuesta 200:**
```json
{
  "ok": true,
  "service": "appwrite-export-toolkit",
  "timestamp": "2026-01-15T10:30:00.000Z"
}
```

---

## Errores comunes

| Código | Significado |
|--------|-------------|
| 400 | Body inválido o campos faltantes |
| 401 | No estás autenticado (cookie faltante o inválida) |
| 403 | Token CSRF inválido o faltante |
| 404 | Resource no encontrado (job, schedule, backup) |
| 405 | Método HTTP no permitido |
| 409 | Conflicto (schedule ya ejecutándose) |
| 500 | Error interno del servidor |
