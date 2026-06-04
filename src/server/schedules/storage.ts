import { mkdirSync, accessSync, readFileSync, writeFileSync, readdirSync, rmSync, renameSync, statSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { randomUUID } from "node:crypto";

import {
  HISTORY_LIMIT,
  type Schedule,
  type ScheduleInput,
  type SchedulePatch,
  type ScheduleSummary,
  type ScheduleRun,
  type ScheduleRunStatus,
  scheduleSchema,
} from "./types";
import { logger } from "../utils/logger";

const SCHEDULES_DIRNAME = ".schedules";

let cachedDir: string | null = null;

function resolveSchedulesDir(): string {
  if (cachedDir !== null) return cachedDir;

  const candidates = [
    process.env.BACKUP_OUTPUT_DIR,
    "/data",
    path.resolve(process.cwd(), ".data"),
    os.tmpdir(),
  ].filter((value): value is string => typeof value === "string" && value.length > 0);

  for (const candidate of candidates) {
    const resolved = path.resolve(candidate, SCHEDULES_DIRNAME);
    try {
      mkdirSync(resolved, { recursive: true });
      accessSync(resolved);
      cachedDir = resolved;
      logger.info({ dir: resolved, source: candidate }, "Schedules directory resolved");
      return resolved;
    } catch {
      // try next candidate
    }
  }

  const fallback = path.join(os.tmpdir(), SCHEDULES_DIRNAME);
  mkdirSync(fallback, { recursive: true });
  cachedDir = fallback;
  logger.warn({ dir: fallback }, "Schedules directory fell back to tmp");
  return fallback;
}

function scheduleFilePath(id: string): string {
  const safe = id.replace(/[^a-zA-Z0-9_-]/g, "_");
  return path.join(resolveSchedulesDir(), `${safe}.json`);
}

function parseScheduleFile(filePath: string): Schedule | null {
  try {
    const raw = readFileSync(filePath, "utf-8");
    const parsed = JSON.parse(raw) as unknown;
    const result = scheduleSchema.safeParse(parsed);
    if (!result.success) {
      logger.warn({ filePath, issues: result.error.issues }, "Skipping invalid schedule file");
      return null;
    }
    return result.data;
  } catch (err) {
    logger.warn({ filePath, err: err instanceof Error ? err.message : String(err) }, "Failed to read schedule file");
    return null;
  }
}

function toSummary(schedule: Schedule): ScheduleSummary {
  return {
    id: schedule.id,
    name: schedule.name,
    cronExpression: schedule.cronExpression,
    timezone: schedule.timezone,
    module: schedule.module,
    target: schedule.target,
    enabled: schedule.enabled,
    createdAt: schedule.createdAt,
    updatedAt: schedule.updatedAt,
    lastRunAt: schedule.lastRunAt,
    lastRunStatus: schedule.lastRunStatus,
    lastRunJobId: schedule.lastRunJobId,
    nextRunAt: schedule.nextRunAt,
  };
}

/**
 * Devuelve la lista completa de schedules persistidos en disco, ordenados
 * por fecha de creación de forma ascendente.
 *
 * @returns Arreglo de objetos Schedule con todos los campos.
 */
export function listSchedules(): Schedule[] {
  const dir = resolveSchedulesDir();
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return [];
  }

  const schedules: Schedule[] = [];
  for (const entry of entries) {
    if (!entry.endsWith(".json")) continue;
    const filePath = path.join(dir, entry);
    try {
      const stat = statSync(filePath);
      if (!stat.isFile()) continue;
    } catch {
      continue;
    }
    const schedule = parseScheduleFile(filePath);
    if (schedule !== null) schedules.push(schedule);
  }

  schedules.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  return schedules;
}

/**
 * Devuelve una versión resumida de todos los schedules, incluyendo solo
 * los campos necesarios para listados y vistas previas.
 *
 * @returns Arreglo de objetos ScheduleSummary.
 */
export function listScheduleSummaries(): ScheduleSummary[] {
  return listSchedules().map(toSummary);
}

/**
 * Busca y devuelve un schedule por su ID. Si no existe o el archivo
 * es inválido, devuelve null.
 *
 * @param id - Identificador único del schedule.
 * @returns El objeto Schedule o null si no se encuentra.
 */
export function getSchedule(id: string): Schedule | null {
  const filePath = scheduleFilePath(id);
  return parseScheduleFile(filePath);
}

function persistSchedule(schedule: Schedule): Schedule {
  const validated = scheduleSchema.parse(schedule);
  const filePath = scheduleFilePath(schedule.id);
  const tmpPath = `${filePath}.tmp`;
  writeFileSync(tmpPath, JSON.stringify(validated, null, 2), "utf-8");
  renameSync(tmpPath, filePath);
  return validated;
}

/**
 * Crea un nuevo schedule a partir de los datos de entrada, genera un ID
 * único y lo persiste en disco.
 *
 * @param input - Datos de configuración del schedule (nombre, cron, módulo, etc.).
 * @returns El objeto Schedule creado con los campos de control (id, fechas, historial vacío).
 */
export function createSchedule(input: ScheduleInput): Schedule {
  const now = new Date().toISOString();
  const id = `sch_${randomUUID().replace(/-/g, "").slice(0, 16)}`;

  const schedule: Schedule = {
    id,
    name: input.name,
    cronExpression: input.cronExpression,
    timezone: input.timezone,
    module: input.module,
    target: input.target,
    enabled: input.enabled,
    createdAt: now,
    updatedAt: now,
    history: [],
  };

  return persistSchedule(schedule);
}

/**
 * Aplica un parche parcial a un schedule existente. Solo se modifican
 * los campos incluidos en el patch; el resto se conserva.
 *
 * @param id - Identificador del schedule a actualizar.
 * @param patch - Campos a modificar (parcial).
 * @returns El schedule actualizado o null si no se encontró.
 */
export function updateSchedule(id: string, patch: SchedulePatch): Schedule | null {
  const current = getSchedule(id);
  if (current === null) return null;

  const next: Schedule = {
    ...current,
    name: patch.name ?? current.name,
    cronExpression: patch.cronExpression ?? current.cronExpression,
    timezone: patch.timezone ?? current.timezone,
    module: patch.module ?? current.module,
    target: patch.target ?? current.target,
    enabled: patch.enabled ?? current.enabled,
    updatedAt: new Date().toISOString(),
  };

  return persistSchedule(next);
}

/**
 * Elimina el archivo JSON de un schedule del disco.
 *
 * @param id - Identificador del schedule a eliminar.
 * @returns true si se eliminó correctamente, false si hubo un error.
 */
export function deleteSchedule(id: string): boolean {
  const filePath = scheduleFilePath(id);
  try {
    rmSync(filePath, { force: true });
    return true;
  } catch (err) {
    logger.warn({ id, err: err instanceof Error ? err.message : String(err) }, "Failed to delete schedule file");
    return false;
  }
}

/**
 * Registra una ejecución en el historial del schedule. El historial se
 * mantiene ordenado cronológicamente y se recorta al límite máximo.
 *
 * @param id - Identificador del schedule al que se agrega la ejecución.
 * @param run - Datos de la ejecución (estado, fechas, jobId asociado).
 * @returns El schedule actualizado o null si no se encontró.
 */
export function appendRun(id: string, run: ScheduleRun): Schedule | null {
  const current = getSchedule(id);
  if (current === null) return null;

  const history = [run, ...current.history].slice(0, HISTORY_LIMIT);
  const lastRunAt = run.ranAt;
  const lastRunStatus: ScheduleRunStatus = run.status;
  const lastRunJobId = run.jobId;

  return persistSchedule({
    ...current,
    history,
    lastRunAt,
    lastRunStatus,
    lastRunJobId,
    updatedAt: new Date().toISOString(),
  });
}

/**
 * Actualiza la fecha de la próxima ejecución programada de un schedule.
 * Se usa para reprogramar o cancelar la siguiente ejecución.
 *
 * @param id - Identificador del schedule.
 * @param nextRunAt - Fecha ISO de la próxima ejecución, o undefined para desprogramar.
 * @returns El schedule actualizado o null si no se encontró.
 */
export function setNextRun(id: string, nextRunAt: string | undefined): Schedule | null {
  const current = getSchedule(id);
  if (current === null) return null;

  const next: Schedule = {
    ...current,
    nextRunAt,
    updatedAt: new Date().toISOString(),
  };

  return persistSchedule(next);
}

/**
 * Devuelve la ruta del directorio donde se almacenan los archivos de schedules.
 * Si el directorio aún no fue resuelto, lo inicializa en ese momento.
 *
 * @returns Ruta absoluta del directorio de schedules.
 */
export function getSchedulesDir(): string {
  return resolveSchedulesDir();
}

/**
 * Resetea la caché del directorio de schedules, forzando que la próxima
 * llamada a getSchedulesDir() resuelva el directorio nuevamente.
 *
 * @returns void
 */
export function resetSchedulesDirCache(): void {
  cachedDir = null;
}
