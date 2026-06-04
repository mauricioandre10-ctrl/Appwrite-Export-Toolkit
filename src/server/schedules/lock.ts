import { mkdirSync, rmSync, statSync } from "node:fs";
import path from "node:path";

import { logger } from "../utils/logger";
import { getSchedulesDir } from "./storage";

const LOCK_STALE_MS = 30 * 60 * 1000;

function lockFilePath(scheduleId: string): string {
  const safe = scheduleId.replace(/[^a-zA-Z0-9_-]/g, "_");
  return path.join(getSchedulesDir(), `${safe}.lock`);
}

/**
 * Intenta adquirir un lock exclusivo para un schedule.
 *
 * @param scheduleId - Identificador del schedule a bloquear.
 * @returns `true` si se obtuvo el lock, `false` si ya está ocupado o no se pudo adquirir.
 */
export function acquireLock(scheduleId: string): boolean {
  const filePath = lockFilePath(scheduleId);

  try {
    mkdirSync(filePath, { recursive: false });
    return true;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "EEXIST") {
      if (isLockStale(filePath)) {
        logger.warn({ scheduleId }, "Stale schedule lock detected, removing");
        try {
          rmSync(filePath, { recursive: true, force: true });
        } catch {
          return false;
        }
        try {
          mkdirSync(filePath, { recursive: false });
          return true;
        } catch {
          return false;
        }
      }
      return false;
    }
    return false;
  }
}

/**
 * Libera el lock de un schedule, eliminando el archivo de lock del disco.
 *
 * Si el archivo de lock no existe o hay un error de I/O al eliminarlo, se loguea
 * un warning pero la función no lanza excepciones (fail-safe).
 *
 * @param scheduleId - Identificador del schedule cuyo lock se desea liberar.
 *
 * @edge-cases
 * - Si el lock ya fue liberado previamente, la operación es un no-op.
 * - Si hay un error de permisos al borrar el archivo, se registra un warning y se ignora.
 */
export function releaseLock(scheduleId: string): void {
  const filePath = lockFilePath(scheduleId);
  try {
    rmSync(filePath, { recursive: true, force: true });
  } catch (err) {
    logger.warn(
      { scheduleId, err: err instanceof Error ? err.message : String(err) },
      "Failed to release schedule lock",
    );
  }
}

function isLockStale(filePath: string): boolean {
  try {
    const stat = statSync(filePath);
    return Date.now() - stat.mtimeMs > LOCK_STALE_MS;
  } catch {
    return false;
  }
}

/**
 * Verifica si un schedule tiene un lock activo en disco.
 *
 * Comprueba la existencia del directorio-lock en el sistema de archivos.
 * Si el directorio no existe o hay un error al acceder, retorna `false`.
 *
 * @param scheduleId - Identificador del schedule a consultar.
 * @returns `true` si el lock existe en disco, `false` en caso contrario.
 *
 * @edge-cases
 * - Retorna `false` si el scheduleId contiene caracteres que generan una ruta inválida.
 * - No valida si el lock está stale; usar `acquireLock` para esa lógica.
 */
export function isLocked(scheduleId: string): boolean {
  const filePath = lockFilePath(scheduleId);
  try {
    statSync(filePath);
    return true;
  } catch {
    return false;
  }
}
