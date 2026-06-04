# Sistema de Programacion (Cron Scheduling)

## Vision general

El sistema de scheduling permite ejecutar exports automaticamente segun una expresion cron. Esta compuesto por varias piezas:

```
scheduler-engine.ts   -> Motor cron (croner)
       |
schedule-runner.ts    -> Bridge que ejecuta el export
       |
export-orchestrator.ts -> Logica real de export
       |
storage.ts            -> Persistencia en archivos JSON
       |
lock.ts               -> Prevencion de ejecuciones concurrentes
```

## Motor del scheduler

Basado en [croner](https://www.npmjs.com/package/croner), un parser de cron puro en JS sin dependencias nativas.

Cada schedule se registra como una instancia `Cron` en un Map in-memory:

```typescript
// src/server/schedules/scheduler-engine.ts
const jobs = new Map<string, Cron>();

export function register(schedule: Schedule): boolean {
  if (jobs.has(schedule.id)) {
    unregister(schedule.id);
  }

  const cron = new Cron(
    schedule.cronExpression,
    {
      name: `schedule-${schedule.id}`,
      timezone: schedule.timezone,
      protect: true,  // Previene ejecuciones superpuestas
    },
    () => { handleTick(schedule); },
  );

  jobs.set(schedule.id, cron);
  return true;
}
```

La funcion `protect: true` de croner ya evita overlap, pero ademas tenemos nuestro propio lock (ver abajo).

## Almacenamiento de schedules

Cada schedule es un archivo JSON en `.data/.schedules/`:

```
.data/.schedules/
  sch_abc123.json
  sch_def456.json
```

El ID se sanitiza para evitar problemas de filesystem:

```typescript
function scheduleFilePath(id: string): string {
  const safe = id.replace(/[^a-zA-Z0-9_-]/g, "_");
  return path.join(resolveSchedulesDir(), `${safe}.json`);
}
```

### Estructura de un schedule

```typescript
type Schedule = {
  id: string;                    // sch_<uuid16>
  name: string;                  // Nombre descriptivo
  cronExpression: string;        // "0 2 * * *" (cron estandar)
  timezone: string;              // "America/Mexico_City"
  module: "all" | "auth" | "databases" | "storage";
  target: "source" | "target";
  enabled: boolean;
  createdAt: string;             // ISO timestamp
  updatedAt: string;
  lastRunAt?: string;
  lastRunStatus?: "success" | "failed" | "running";
  lastRunJobId?: string;
  nextRunAt?: string;
  history: ScheduleRun[];        // Ultimos 20 runs
};
```

Los archivos se validan con Zod al leerlos. Si un archivo esta corrupto, se salta silenciosamente.

## Flujo de registro/desregistro

### Bootstrap (al iniciar la app)

```typescript
// src/instrumentation.ts
export async function register(): Promise<void> {
  if (process.env.SCHEDULER_DISABLED === "1") return;
  const { bootstrap } = await import("./server/schedules/scheduler-engine");
  bootstrap();  // -> reloadAll() -> lee todos los .json y registra los habilitados
}
```

### Al modificar un schedule via API

```typescript
// refreshAfterPatch() re-leo el archivo y re-registra si esta habilitado
export function refreshAfterPatch(id: string): void {
  const schedule = getSchedule(id);
  if (schedule === null) { unregister(id); return; }
  if (schedule.enabled) { register(schedule); }
  else { unregister(id); }
}
```

## Tick handling

Cuando croner detecta que es hora de ejecutar:

```typescript
async function handleTick(schedule: Schedule): Promise<void> {
  // 1. Intentar adquirir lock
  if (!acquireLock(schedule.id)) {
    logger.info({ id: schedule.id }, "Schedule skipped (already running)");
    return;
  }

  try {
    // 2. Import dinamico para no cargar todo al bootstrap
    const { runScheduledExport } = await import("./schedule-runner");
    await runScheduledExport(schedule, "scheduled");
  } catch (err) {
    logger.error({ id: schedule.id, err }, "Schedule tick crashed");
  } finally {
    // 3. Siempre liberar el lock
    releaseLock(schedule.id);
  }
}
```

## Mecanismo de lock

El lock previene que un schedule se ejecute dos veces simultaneamente. Usa `mkdir` como primitiva atomica:

```typescript
// src/server/schedules/lock.ts
export function acquireLock(scheduleId: string): boolean {
  const filePath = lockFilePath(scheduleId);

  try {
    mkdirSync(filePath, { recursive: false });  // Atomic: falla si ya existe
    return true;
  } catch (err) {
    if (err.code === "EEXIST") {
      // Verificar si el lock es viejo (stale)
      if (isLockStale(filePath)) {
        rmSync(filePath, { recursive: true, force: true });
        mkdirSync(filePath, { recursive: false });
        return true;
      }
      return false;
    }
    return false;
  }
}
```

- `mkdirSync` es atomica en la mayoria de filesystems
- Si el lock tiene mas de 30 minutos, se considera stale (crash previo que no libero)
- El directorio `.lock` se crea en `.data/.schedules/`

## Schedule runner

El `schedule-runner.ts` es el bridge entre el scheduler y el export-orquestador:

```typescript
export async function runScheduledExport(
  schedule: Schedule,
  trigger: ScheduleRunTrigger = "scheduled",
  options: RunOptions = {},
): Promise<ScheduleRunResult> {
  // 1. Re-leer el schedule (puede haber cambiado entre trigger y ejecucion)
  const current = getSchedule(schedule.id);
  const effective = current ?? schedule;

  // 2. Crear job y placeholder en historial
  const jobId = options.preAllocatedJobId ?? await createJobId("export");
  setCurrentJob(effective.id, jobId);

  // 3. Ejecutar el export
  const config = resolveConfig(effective.target);
  const services = createAppwriteServices(config);
  const selection = parseExportSelection(effective.module);

  const summary = await exportBackup({
    selection, config, services, jobId,
  });

  // 4. Actualizar historial con resultado final
  const finalRun = buildFinalRun(startedAt, finishedAt, trigger, "success", jobId);
  appendRun(effective.id, finalRun);

  return { success: true, jobId, trigger, summary };
}
```

## Tracking de historial

Cada schedule mantiene un array `history` con los ultimos 20 runs:

```typescript
const HISTORY_LIMIT = 20;

export function appendRun(id: string, run: ScheduleRun): Schedule | null {
  const current = getSchedule(id);
  if (current === null) return null;

  const history = [run, ...current.history].slice(0, HISTORY_LIMIT);

  return persistSchedule({
    ...current,
    history,
    lastRunAt: run.ranAt,
    lastRunStatus: run.status,
    lastRunJobId: run.jobId,
    updatedAt: new Date().toISOString(),
  });
}
```

Cada `ScheduleRun` contiene:
- `ranAt`: cuando empezo
- `finishedAt`: cuando termino
- `status`: "success" | "failed" | "running"
- `trigger`: "manual" | "scheduled"
- `durationMs`: duracion en milisegundos
- `jobId`: ID del job asociado (para ver progreso SSE)
- `errorMessage`: si fallo

## Patron de pre-alizacion para SSE streaming

Cuando el cliente dispara un run manual, necesita el `jobId` inmediatamente para suscribirse al SSE. Pero el job aun no existe en el servidor.

El patron de pre-alocacion resuelve esto:

```typescript
// En la API route:
const jobId = await createJobId("export");
// Reservar el ID sin crear el archivo todavia

// Devolver jobId al cliente inmediatamente
return Response.json({ jobId });

// El cliente se suscribe a SSE con ese jobId
// Mientras tanto, el servidor crea el job y empieza a escribir progreso
```

El `running-jobs.ts` almacena en memoria que schedule esta ejecutando que job:

```typescript
const currentJobs = new Map<string, string>(); // scheduleId -> jobId

export function setCurrentJob(scheduleId: string, jobId: string): void {
  currentJobs.set(scheduleId, jobId);
}
```

Esto permite que el panel de schedules muestre progreso en tiempo real sin polling.

## Deshabilitar el scheduler

Para deshabilitar completamente el sistema de cron (ej: en tests):

```bash
SCHEDULER_DISABLED=1 npm run dev
```

O para un schedule individual, ponlo en `enabled: false` via la API o editando el JSON directamente.
