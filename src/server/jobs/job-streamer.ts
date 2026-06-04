import { exportBackup, parseExportSelection } from "../exporters/export-orchestrator";
import { importBackup, parseImportSelection } from "../import/import-orchestrator";
import { createAppwriteServices } from "../appwrite/client";
import { loadAppwriteConfig, loadTargetConfig } from "../appwrite/config";
import { completeJob, getJob, updateJob, type JobProgress } from "../import/progress-store";

/** Evento emitido durante el streaming de un job, incluyendo progreso, finalización o error. */
export type StreamEvent =
  | { event: "progress"; data: { jobId: string; percent: number; phase: string; module: string; detail: string } }
  | { event: "complete"; data: { jobId: string; status: "completed"; redirectUrl: string } }
  | { event: "error-event"; data: { jobId: string; error: string } };

/** Función emisora para enviar eventos SSE al cliente. */
export type Emitter = (event: StreamEvent["event"], data: StreamEvent["data"]) => void;

const POLL_INTERVAL_MS = 500;
const PROGRESS_POLL_TIMEOUT_MS = 30 * 60 * 1000;

/**
 * In-process set of jobIds that this streamer instance is currently executing.
 * Used to break ties when multiple SSE subscribers open at the exact same time
 * for a status="pending" job (e.g., user double-clicks "Ejecutar ahora"). The
 * first subscriber to enter the function claims the jobId; any concurrent
 * subscriber sees the jobId in this set and falls back to observability.
 *
 * The schedules path doesn't need this guard: the runner pre-marks the job
 * with status="running" BEFORE returning 202 to the client, so subscribers
 * always see status="running" and never reach the "pending" branch.
 */
const executingJobs = new Set<string>();

/**
 * Streams a job's progress to the SSE client. The function is idempotent: opening
 * the stream for a job that is already being executed by another process (e.g., the
 * schedule runner) will NOT start a new export. It will only poll the job file and
 * forward progress + terminal events to the subscriber.
 *
 * Behaviour by job status:
 *  - "pending": the stream route is the executor (e.g., POST /api/export). The job
 *    is atomically transitioned to "running" and the export is started.
 *  - "running": another process is executing the job. We poll the job file and
 *    forward progress events until the status becomes terminal.
 *  - "completed": emit a final "complete" event with the redirectUrl and stop.
 *  - "failed": emit a final "error-event" with the error and stop.
 */

/**
 * Maneja el streaming del progreso de un job hacia el cliente SSE.
 * Decide si ejecutar, observar o emitir el resultado final según el estado del job.
 *
 * @param jobId - Identificador único del job a procesar.
 * @param initialJob - Estado inicial del job al momento de abrir el stream.
 * @param emit - Función emisora para enviar eventos SSE al cliente.
 * @returns Promesa que se resuelve cuando el job termina o el stream se cierra.
 */
export async function streamJob(
  jobId: string,
  initialJob: JobProgress,
  emit: Emitter,
): Promise<void> {
  if (initialJob.status === "pending") {
    if (executingJobs.has(jobId)) {
      // Another streamer in this process is already executing. Observe.
      await observeJob(jobId, initialJob, emit);
      return;
    }
    executingJobs.add(jobId);
    try {
      await executeJob(jobId, initialJob, emit);
    } finally {
      executingJobs.delete(jobId);
    }
    return;
  }

  if (initialJob.status === "running") {
    await observeJob(jobId, initialJob, emit);
    return;
  }

  if (initialJob.status === "completed") {
    emitCompleteFromResult(jobId, initialJob, emit);
    return;
  }

  if (initialJob.status === "failed") {
    emitErrorFromJob(jobId, initialJob, emit);
    return;
  }

  // Unknown / future status. Surface as an error so the client doesn't hang.
  emit("error-event", { jobId, error: `Unknown job status: ${String(initialJob.status)}` });
}

async function executeJob(jobId: string, job: JobProgress, emit: Emitter): Promise<void> {
  // Mark as running so any other concurrent subscriber will observe instead of execute.
  await updateJob(jobId, { status: "running" });

  if (job.type === "export") {
    await runExportInStream(jobId, job.module || "all", emit);
  } else {
    await runImportInStream(jobId, job.module || "all", job.result as string | undefined, emit);
  }
}

/**
 * Observa un job en ejecución leyendo periódicamente su archivo JSON y emitiendo
 * eventos de progreso al cliente SSE. Se utiliza cuando el job ya está siendo
 * procesado por otro proceso (por ejemplo, el programador de schedules) o por
 * otro subscriber concurrente.
 *
 * La función implementa un bucle de polling con intervalo de POLL_INTERVAL_MS (500ms).
 * Mantiene un objeto `lastEmitted` para deduplicar: solo emite un evento "progress"
 * cuando percent, phase, module o status cambian respecto al último emitido, lo que
 * reduce el consumo de ancho de banda en SSE.
 *
 * El bucle termina cuando el status del job deja de ser "running" o "pending":
 * - Si es "completed": emite un evento "complete" con la URL de redirección.
 * - Si es "failed": emite un evento "error-event" con el mensaje de error.
 * - Cualquier otro estado inesperado también se reporta como error.
 *
 * Lanza un error si el archivo del job desaparece durante la ejecución o si el
 * polling excede el timeout de PROGRESS_POLL_TIMEOUT_MS (30 minutos).
 *
 * @param jobId - Identificador del job a observar.
 * @param startJob - Estado inicial del job al momento de iniciar la observación.
 * @param emit - Función emisora para enviar eventos SSE al cliente.
 * @returns Promesa que se resuelve cuando el job alcanza un estado terminal.
 */
async function observeJob(
  jobId: string,
  startJob: JobProgress,
  emit: Emitter,
): Promise<void> {
  const lastEmitted = {
    percent: startJob.percent,
    phase: startJob.phase,
    module: startJob.module,
    status: startJob.status,
  };
  emitProgressFromJob(jobId, startJob, emit, lastEmitted);

  const startedAt = Date.now();
  let current: JobProgress = startJob;

  while (current.status === "running" || current.status === "pending") {
    if (Date.now() - startedAt > PROGRESS_POLL_TIMEOUT_MS) {
      emit("error-event", { jobId, error: "Job progress polling timed out" });
      return;
    }
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    const fresh = await getJob(jobId);
    if (fresh === undefined) {
      emit("error-event", { jobId, error: "Job file disappeared during execution" });
      return;
    }
    current = fresh;
    emitProgressFromJob(jobId, current, emit, lastEmitted);
  }

  if (current.status === "completed") {
    emitCompleteFromResult(jobId, current, emit);
  } else if (current.status === "failed") {
    emitErrorFromJob(jobId, current, emit);
  } else {
    emit("error-event", { jobId, error: `Job ended in unexpected status: ${String(current.status)}` });
  }
}

/**
 * Compara el estado actual del job con el último emitido y, solo si hay cambios,
 * envía un evento "progress" al cliente SSE y actualiza `lastEmitted`.
 *
 * La deduplicación es importante en conexiones SSE porque cada evento consume
 * ancho de banda y el cliente puede estar en una red lenta. Si el job no cambia
 * entre polls (por ejemplo, un módulo que tarda varios minutos), se evita enviar
 * el mismo percent/phase/module una y otra vez.
 *
 * @param jobId - Identificador del job.
 * @param job - Estado actual del job leído del archivo.
 * @param emit - Función emisora para enviar eventos SSE.
 * @param lastEmitted - Objeto mutable que rastrea los valores del último evento emitido.
 *                      Se actualiza in-place cuando hay un cambio.
 * @returns void — no retorna valor. Si no hay cambios, no emite nada.
 */
function emitProgressFromJob(
  jobId: string,
  job: JobProgress,
  emit: Emitter,
  lastEmitted: { percent: number; phase: string; module: string; status: string },
): void {
  if (
    job.percent === lastEmitted.percent &&
    job.phase === lastEmitted.phase &&
    job.module === lastEmitted.module &&
    job.status === lastEmitted.status
  ) {
    return;
  }
  lastEmitted.percent = job.percent;
  lastEmitted.phase = job.phase;
  lastEmitted.module = job.module;
  lastEmitted.status = job.status;
  emit("progress", { jobId, percent: job.percent, phase: job.phase, module: job.module, detail: job.detail });
}

/**
 * Emite un evento "complete" con la URL de redirección apropiada según el tipo
 * de job. La construcción del redirectUrl difiere entre import y export:
 *
 * - **Import**: redirige a `/?imported={backupId}&importStatus={status}&tab=import`,
 *   incluyendo el estado de la importación (complete/partial/failed) y la pestaña
 *   de importación.
 * - **Export**: redirige a `/?exported={backupId}` de forma más simple.
 *
 * Si el resultado no contiene backupId, se usa una cadena vacía como fallback.
 * Para imports, el status del resultado se extrae de `result.status` con un
 * valor por defecto de "complete" si no está presente.
 *
 * @param jobId - Identificador del job completado.
 * @param job - Objeto JobProgress con el resultado de la operación en `job.result`.
 * @param emit - Función emisora para enviar eventos SSE.
 * @returns void — no retorna valor.
 */
function emitCompleteFromResult(jobId: string, job: JobProgress, emit: Emitter): void {
  const result = job.result as { backupId?: string; status?: string } | undefined;
  const backupId = result?.backupId;
  if (job.type === "import") {
    const importStatus = result?.status ?? "complete";
    const path = backupId ?? "";
    emit("complete", {
      jobId,
      status: "completed",
      redirectUrl: `/?imported=${encodeURIComponent(path)}&importStatus=${importStatus}&tab=import`,
    });
    return;
  }
  // Export
  const id = backupId ?? "";
  emit("complete", {
    jobId,
    status: "completed",
    redirectUrl: `/?exported=${encodeURIComponent(id)}`,
  });
}

function emitErrorFromJob(jobId: string, job: JobProgress, emit: Emitter): void {
  const error = job.error ?? job.detail ?? "Unknown error";
  emit("error-event", { jobId, error });
}

/**
 * Ejecuta el ciclo completo de exportación dentro del contexto de streaming SSE.
 * Carga la configuración de Appwrite, crea los servicios necesarios, parsea la
 * selección de módulos y ejecuta exportBackup con un callback de progreso que
 * emite eventos "progress" al cliente en cada actualización.
 *
 * Al finalizar, registra el resultado en el progress-store con completeJob y
 * emite un evento "complete" con la URL de redirección que incluye el backupId
 * y el módulo exportado.
 *
 * El progreso se emite en dos fases: primero un evento inicial de "preparando"
 * al 0%, y luego los eventos del exportBackup que van desde el % calculado por
 * módulo hasta el 95% (checksums). El 100% se registra internamente en
 * completeJob pero no se emite como evento SSE.
 *
 * @param jobId - Identificador del job de exportación.
 * @param moduleParam - Nombre del módulo a exportar o "all" para todos.
 * @param emit - Función emisora para enviar eventos SSE al cliente.
 * @returns Promesa que se resuelve cuando la exportación completa termina.
 * @throws Si exportBackup lanza un error no capturado (errores de red, disk, etc.).
 */
async function runExportInStream(jobId: string, moduleParam: string, emit: Emitter): Promise<void> {
  emit("progress", { jobId, percent: 0, phase: "preparando", module: "", detail: "Cargando configuracion" });

  const config = loadAppwriteConfig();
  const services = createAppwriteServices(config);
  const selection = parseExportSelection(moduleParam);

  const result = await exportBackup({
    selection,
    config,
    services,
    jobId,
    onProgress: (percent, phase, module) => {
      emit("progress", { jobId, percent, phase, module, detail: "" });
    },
  });

  await completeJob(jobId, result);

  emit("complete", {
    jobId,
    status: "completed",
    redirectUrl: `/?exported=${encodeURIComponent(result.backupId)}&exportModule=${encodeURIComponent(moduleParam)}`,
  });
}

/**
 * Ejecuta el ciclo completo de importación dentro del contexto de streaming SSE.
 * Carga la configuración target de Appwrite, crea los servicios, parsea la
 * selección de módulos y ejecuta importBackup con un callback de progreso que
 * emite eventos "progress" al cliente.
 *
 * **Lanza un Error** si el parámetro `backupId` es undefined o vacío, ya que
 * no se puede ejecutar una importación sin saber qué backup restaurar.
 *
 * Al finalizar, registra el resultado en el progress-store con completeJob y
 * emite un evento "complete" con la URL de redirección que incluye el backupId,
 * el módulo importado, el estado de la importación y la pestaña de importación.
 *
 * @param jobId - Identificador del job de importación.
 * @param moduleParam - Nombre del módulo a importar o "all" para todos.
 * @param backupId - Identificador del backup a restaurar. Debe estar definido.
 * @param emit - Función emisora para enviar eventos SSE al cliente.
 * @returns Promesa que se resuelve cuando la importación completa termina.
 * @throws Error si backupId es undefined o cadena vacía.
 */
async function runImportInStream(
  jobId: string,
  moduleParam: string,
  backupId: string | undefined,
  emit: Emitter,
): Promise<void> {
  emit("progress", { jobId, percent: 0, phase: "preparando", module: "", detail: "Cargando configuracion target" });

  if (!backupId) {
    throw new Error("No se encontro backupId en el job");
  }

  const config = loadTargetConfig();
  const services = createAppwriteServices(config);
  const selection = parseImportSelection(moduleParam);

  const result = await importBackup({
    selection,
    config,
    services,
    backupPath: backupId,
    jobId,
    onProgress: (percent, phase, module) => {
      emit("progress", { jobId, percent, phase, module, detail: "" });
    },
  });

  await completeJob(jobId, result);

  emit("complete", {
    jobId,
    status: "completed",
    redirectUrl: `/?imported=${encodeURIComponent(backupId)}&importModule=${encodeURIComponent(moduleParam)}&importStatus=${result.status}&tab=import`,
  });
}
