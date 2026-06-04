import fs from "node:fs/promises";
import { mkdirSync, accessSync } from "node:fs";
import path from "node:path";
import os from "node:os";

const jobLocks = new Map<string, Promise<void>>();

/**
 * Serializa ejecuciones concurrentes para un mismo jobId usando un patrón
 * de cadena de promesas. Cada llamada se encola al final de la anterior,
 * garantizando que solo una operación modifica el job a la vez.
 *
 * El .then(fn, fn) ejecuta fn tanto si la promesa previa resolvió como si falló,
 * así que nunca se pierde una operación por un error previo. El cleanup del
 * finally solo borra la cadena del mapa si esta instancia es la última en
 * encolarse (evita borrar la cadena de otra operación concurrente).
 *
 * @param jobId - Identificador del job sobre el que se aplica el lock.
 * @param fn - Función asíncrona que se ejecuta serializada dentro del lock.
 * @returns La resolución de fn.
 */
async function withJobLock<T>(jobId: string, fn: () => Promise<T>): Promise<T> {
  // Patrón de cadena de promesas para serializar operaciones por job.
  // Cada llamada engancha su ejecución al final de la anterior (prev.then(fn, fn)).
  // El .then(fn, fn) ejecuta fn tanto si la anterior resolvió como si falló,
  // así que nunca se pierde una operación por un error previo.
  // La clave del mapa apunta a una versión "limpia" (sin valor) de la promesa,
  // para que el cleanup del finally no dependa del resultado de fn.
  const prev = jobLocks.get(jobId) ?? Promise.resolve();
  const next = prev.then(fn, fn);
  jobLocks.set(jobId, next.then(() => {}));
  try {
    return await next;
  } finally {
    // Solo borramos la cadena si somos los últimos en encolarse;
    // si alguien más se encoló mientras tanto, su referencia sigue en el mapa.
    if (jobLocks.get(jobId) === next.then(() => {})) {
      jobLocks.delete(jobId);
    }
  }
}

/**
 * Representa los posibles estados de un job de importación o exportación.
 * Puede estar pendiente, en ejecución, completado o con error.
 */
export type JobStatus = "pending" | "running" | "completed" | "failed";

/**
 * Información completa del progreso de un job. Se persiste como archivo JSON
 * y se actualiza a medida que avanza la operación.
 */
export type JobProgress = {
  jobId: string;
  type: "import" | "export";
  status: JobStatus;
  percent: number;
  phase: string;
  module: string;
  detail: string;
  startedAt: string;
  finishedAt: string;
  result?: unknown;
  error?: string | undefined;
};

function resolveJobsDir(): string {
  const candidates = [
    process.env.BACKUP_OUTPUT_DIR,
    "/data",
    path.resolve(process.cwd(), ".data"),
    os.tmpdir(),
  ].filter((value): value is string => typeof value === "string" && value.length > 0);

  for (const candidate of candidates) {
    const resolved = path.resolve(candidate, ".jobs");
    try {
      mkdirSync(resolved, { recursive: true });
      accessSync(resolved);
      return resolved;
    } catch {
      // try next candidate
    }
  }

  return path.join(os.tmpdir(), ".jobs");
}

let cachedJobsDir: string | null = null;

async function getJobsDir(): Promise<string> {
  if (cachedJobsDir !== null) return cachedJobsDir;
  const dir = resolveJobsDir();
  await fs.mkdir(dir, { recursive: true });
  cachedJobsDir = dir;
  return dir;
}

let jobCounter = 0;

async function jobFilePath(jobId: string): Promise<string> {
  const dir = await getJobsDir();
  return path.join(dir, `${jobId}.json`);
}

async function writeJob(job: JobProgress): Promise<void> {
  const filePath = await jobFilePath(job.jobId);
  await fs.writeFile(filePath, JSON.stringify(job, null, 2), "utf-8");
}

/**
 * Genera un ID único para un job. El formato es "{type}_{sanitizedTimestamp}_{counter}",
 * donde el timestamp ISO sanitiza ":" por "-" y elimina los milisegundos finales (por
 * ejemplo: `export_2026-06-01T12-00-00Z_1`). El contador es incremental a nivel de
 * módulo y se incrementa en cada llamada, por lo que nunca produce duplicados dentro
 * de la misma ejecución del proceso. Se asegura de que el directorio de jobs exista
 * antes de generar el ID.
 *
 * @param type - Tipo de operación: "import" o "export".
 * @returns Una cadena con el ID en el formato descrito.
 */
export async function createJobId(type: "import" | "export"): Promise<string> {
  await getJobsDir();
  jobCounter += 1;
  const ts = new Date().toISOString().replaceAll(":", "-").replace(/\.\d{3}Z$/, "Z");
  return `${type}_${ts}_${jobCounter}`;
}

/**
 * Crea un nuevo job con estado inicial "pending" y lo persiste como archivo JSON
 * en el directorio de jobs. Inicializa todos los campos con valores por defecto:
 * percent=0, phase="initializing", module y detail vacíos, startedAt con la fecha
 * actual y finishedAt vacío.
 *
 * Si ya existe un archivo con el mismo jobId, se sobreescribe sin advertencia.
 * Esto permite reutilizar un jobId si se llama dos veces con el mismo identificador.
 *
 * @param jobId - Identificador único del job (generado previamente con createJobId).
 * @param type - Tipo de operación: "import" o "export".
 * @returns El objeto JobProgress creado con los valores por defecto.
 */
export async function createJob(jobId: string, type: "import" | "export"): Promise<JobProgress> {
  const job: JobProgress = {
    jobId,
    type,
    status: "pending",
    percent: 0,
    phase: "initializing",
    module: "",
    detail: "",
    startedAt: new Date().toISOString(),
    finishedAt: "",
  };
  await writeJob(job);
  return job;
}

/**
 * Aplica parciales actualizaciones a un job existente. Utiliza un lock por job
 * (withJobLock) para serializar escrituras concurrentes y evitar que se pierdan
 * datos. Si el job no existe en disco (archivo ausente o JSON inválido), la
 * operación retorna silenciosamente sin lanzar error.
 *
 * Los campos jobId y type no se pueden modificar; el objeto `updates` los excluye
 * por diseño (Partial<Omit<JobProgress, "jobId" | "type">>).
 *
 * @param jobId - Identificador del job a actualizar.
 * @param updates - Campos a modificar (parcial, sin jobId ni type).
 * @returns void — no retorna valor. Si el job no existe, no hace nada.
 */
export async function updateJob(jobId: string, updates: Partial<Omit<JobProgress, "jobId" | "type">>): Promise<void> {
  await withJobLock(jobId, async () => {
    const job = await getJob(jobId);
    if (job === undefined) return;
    Object.assign(job, updates);
    await writeJob(job);
  });
}

/**
 * Marca un job como terminado, estableciendo su estado final y registrando
 * timestamps y resultado/error. Utiliza withJobLock para garantizar atomicidad.
 *
 * El comportamiento depende del parámetro `error`:
 * - Si se provee `error`: el status se pone en "failed" y se mantiene el percent
 *   actual sin modificar.
 * - Si no se provee `error`: el status se pone en "completed" y el percent se
 *   fuerza a 100, independientemente del valor previo.
 *
 * En ambos casos se actualiza `finishedAt` con la fecha/hora actual y se almacena
 * el resultado o error proporcionado. Si el job no existe, la operación retorna
 * silenciosamente.
 *
 * @param jobId - Identificador del job a finalizar.
 * @param result - Resultado opcional de la operación (solo se guarda si no hay error).
 * @param error - Mensaje de error opcional. Si se provee, el job se marca como fallido.
 * @returns void — no retorna valor.
 */
export async function completeJob(jobId: string, result?: unknown, error?: string): Promise<void> {
  await withJobLock(jobId, async () => {
    const job = await getJob(jobId);
    if (job === undefined) return;
    job.status = error ? "failed" : "completed";
    job.percent = error ? job.percent : 100;
    job.finishedAt = new Date().toISOString();
    job.result = result;
    job.error = error;
    await writeJob(job);
  });
}

/**
 * Lee y devuelve el estado de un job desde su archivo JSON persistido.
 * Si el archivo no existe o no es válido, devuelve undefined.
 *
 * @param jobId - Identificador del job a consultar.
 * @returns El objeto JobProgress o undefined si no se encuentra.
 */
export async function getJob(jobId: string): Promise<JobProgress | undefined> {
  try {
    const filePath = await jobFilePath(jobId);
    const data = await fs.readFile(filePath, "utf-8");
    return JSON.parse(data) as JobProgress;
  } catch {
    return undefined;
  }
}

/**
 * Elimina archivos de jobs cuya fecha de finalización (o inicio) sea anterior
 * al límite de edad especificado. Útil para limpiar jobs obsoletos del directorio.
 *
 * Para cada archivo JSON en el directorio de jobs, se parsea el contenido y se
 * determina la fecha de referencia: se usa `finishedAt` si el job tiene fecha de
 * finalización (trabajos completados o fallidos), o `startedAt` si el job nunca
 * terminó (trabajos pendientes o en ejecución). Si la diferencia entre "ahora" y
 * esa fecha supera `maxAgeMs`, el archivo se elimina.
 *
 * Los archivos que no se pueden parsear como JSON válido se ignoran silenciosamente.
 *
 * @param maxAgeMs - Edad máxima en milisegundos. Por defecto 1 hora (3 600 000 ms).
 * @returns La cantidad de archivos eliminados.
 */
export async function cleanupOldJobs(maxAgeMs = 3600000): Promise<number> {
  const dir = await getJobsDir();
  const files = await fs.readdir(dir);
  let cleaned = 0;
  const now = Date.now();

  for (const file of files) {
    if (!file.endsWith(".json")) continue;
    try {
      const data = await fs.readFile(path.join(dir, file), "utf-8");
      const job = JSON.parse(data) as JobProgress;
      const finished = job.finishedAt ? new Date(job.finishedAt).getTime() : new Date(job.startedAt).getTime();
      if (now - finished > maxAgeMs) {
        await fs.unlink(path.join(dir, file));
        cleaned += 1;
      }
    } catch {
      // ignore
    }
  }
  return cleaned;
}
