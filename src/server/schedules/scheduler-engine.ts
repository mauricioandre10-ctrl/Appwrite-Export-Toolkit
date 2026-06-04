import { Cron } from "croner";

import { logger } from "../utils/logger";
import { acquireLock, releaseLock } from "./lock";
import {
  getSchedule,
  listSchedules,
  setNextRun,
} from "./storage";
import type { Schedule } from "./types";

const jobs = new Map<string, Cron>();

function computeNextRun(schedule: Schedule): string | undefined {
  try {
    const next = new Cron(schedule.cronExpression, { timezone: schedule.timezone }).nextRun();
    return next ? next.toISOString() : undefined;
  } catch (err) {
    logger.warn(
      { id: schedule.id, err: err instanceof Error ? err.message : String(err) },
      "Failed to compute next run",
    );
    return undefined;
  }
}

// Flujo de cada tick del cron:
// 1) Intentamos adquirir un lock por ID para evitar ejecuciones
//    superpuestas (por ejemplo si un tick anterior aún no terminó).
// 2) Si el lock se obtuvo, importamos dinámicamente schedule-runner
//    y ejecutamos la exportación programada. El import es lazy para
//    no cargar módulos innecesariamente al arrancar el servidor.
// 3) En el finally, siempre liberamos el lock sin importar si hubo
//    éxito o error, para que el próximo tick pueda ejecutarse.
async function handleTick(schedule: Schedule): Promise<void> {
  if (!acquireLock(schedule.id)) {
    logger.info({ id: schedule.id, name: schedule.name }, "Schedule skipped (already running)");
    return;
  }

  logger.info(
    { id: schedule.id, name: schedule.name, module: schedule.module, trigger: "scheduled" },
    "Schedule triggered (cron tick)",
  );

  try {
    const { runScheduledExport } = await import("./schedule-runner");
    await runScheduledExport(schedule, "scheduled");
  } catch (err) {
    logger.error(
      { id: schedule.id, name: schedule.name, err: err instanceof Error ? err.message : String(err) },
      "Schedule tick crashed (unexpected)",
    );
  } finally {
    releaseLock(schedule.id);
  }
}

function makeCron(schedule: Schedule): Cron {
  return new Cron(
    schedule.cronExpression,
    {
      name: `schedule-${schedule.id}`,
      timezone: schedule.timezone,
      protect: true,
    },
    () => {
      handleTick(schedule).catch((err) => {
        logger.error(
          { id: schedule.id, err: err instanceof Error ? err.message : String(err) },
          "Unhandled schedule tick error",
        );
      });
    },
  );
}

/**
 * Registra un schedule en el motor de cron.
 *
 * Si ya existía un job con el mismo ID, se detiene primero. Calcula la
 * próxima ejecución y la almacena para que pueda consultarse después.
 *
 * @param schedule - El schedule a registrar con su expresión cron y timezone.
 * @returns `true` si se registró correctamente, `false` si la expresión cron es inválida.
 */
export function register(schedule: Schedule): boolean {
  if (jobs.has(schedule.id)) {
    unregister(schedule.id);
  }

  try {
    const cron = makeCron(schedule);
    jobs.set(schedule.id, cron);
    const nextRunAt = computeNextRun(schedule);
    setNextRun(schedule.id, nextRunAt);
    logger.info(
      { id: schedule.id, name: schedule.name, cron: schedule.cronExpression, timezone: schedule.timezone, nextRunAt },
      "Schedule registered",
    );
    return true;
  } catch (err) {
    logger.error(
      { id: schedule.id, cron: schedule.cronExpression, err: err instanceof Error ? err.message : String(err) },
      "Failed to register schedule (invalid cron expression?)",
    );
    return false;
  }
}

/**
 * Desregistra un schedule y detiene su job de cron asociado.
 *
 * Limpia el mapa interno de jobs y borra la fecha de próxima ejecución
 * almacenada para ese ID.
 *
 * @param id - El identificador del schedule a desregistrar.
 * @returns `true` si se encontró y detuvo el job, `false` si no existía.
 */
export function unregister(id: string): boolean {
  const cron = jobs.get(id);
  if (cron === undefined) return false;
  cron.stop();
  jobs.delete(id);
  setNextRun(id, undefined);
  logger.info({ id }, "Schedule unregistered");
  return true;
}

/**
 * Verifica si un schedule está registrado activamente en el motor.
 *
 * @param id - El identificador del schedule a consultar.
 * @returns `true` si el schedule tiene un job de cron activo, `false` en caso contrario.
 */
export function isRegistered(id: string): boolean {
  return jobs.has(id);
}

/**
 * Detiene todos los jobs activos y vuelve a cargar todos los schedules
 * habilitados desde el storage.
 *
 * Es útil después de cambios manuales en la base de datos de schedules
 * para sincronizar el estado del motor.
 *
 * @returns Un objeto con el total de schedules encontrados y cuántos se registraron exitosamente.
 */
export function reloadAll(): { total: number; registered: number } {
  jobs.forEach((cron, id) => {
    cron.stop();
    jobs.delete(id);
  });

  const all = listSchedules();
  let registered = 0;
  for (const schedule of all) {
    if (!schedule.enabled) continue;
    if (register(schedule)) registered += 1;
  }
  logger.info({ total: all.length, registered }, "All schedules reloaded");
  return { total: all.length, registered };
}

/**
 * Punto de entrada para inicializar el motor de schedules al arrancar el servidor.
 *
 * Simplemente ejecuta {@link reloadAll} para cargar todos los schedules habilitados.
 */
export function bootstrap(): void {
  reloadAll();
}

/**
 * Calcula la próxima fecha de ejecución de un schedule según su expresión cron.
 *
 * @param schedule - El schedule cuyo próximo run se quiere calcular.
 * @returns La fecha en formato ISO 8601 o `undefined` si no se pudo calcular.
 */
export function getNextRun(schedule: Schedule): string | undefined {
  return computeNextRun(schedule);
}

/**
 * Actualiza el estado de un schedule después de que fue modificado externamente.
 *
 * Si el schedule ya no existe o está deshabilitado, lo desregistra.
 * Si está habilitado, lo (re)registra para que los cambios surtan efecto.
 *
 * @param id - El identificador del schedule que fue actualizado.
 */
export function refreshAfterPatch(id: string): void {
  const schedule = getSchedule(id);
  if (schedule === null) {
    unregister(id);
    return;
  }
  if (schedule.enabled) {
    register(schedule);
  } else {
    unregister(id);
  }
}

/**
 * Detiene todos los jobs de cron activos y limpia el mapa interno.
 *
 * Se llama durante el apagado ordenado del servidor para evitar
 * ejecuciones pendientes.
 */
export function shutdown(): void {
  jobs.forEach((cron, id) => {
    cron.stop();
    logger.info({ id }, "Schedule stopped (shutdown)");
  });
  jobs.clear();
}

/**
 * Lista todos los jobs de cron registrados con su estado de ejecución.
 *
 * Función de utilidad para debugging. No usar en producción.
 *
 * @returns Un array con el ID de cada schedule y si está ejecutándose actualmente.
 */
export function _debugList(): Array<{ id: string; isRunning: boolean }> {
  return Array.from(jobs.entries()).map(([id, cron]) => ({ id, isRunning: cron.isRunning() }));
}
