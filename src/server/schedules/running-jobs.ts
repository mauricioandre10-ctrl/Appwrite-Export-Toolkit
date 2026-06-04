const currentJobs = new Map<string, string>();

/**
 * Registra el job actualmente en ejecución para un schedule dado.
 *
 * Actualiza el mapa interno de jobs en ejecución. Si ya existía un job registrado
 * para el mismo schedule, se sobrescribe silenciosamente.
 *
 * @param scheduleId - Identificador del schedule al que pertenece el job.
 * @param jobId - Identificador único del job que está corriendo.
 *
 * @edge-cases
 * - Si ya hay un job registrado para el mismo scheduleId, se reemplaza sin advertencia.
 *   Esto es intencional: un schedule solo puede tener un job activo a la vez.
 */
export function setCurrentJob(scheduleId: string, jobId: string): void {
  currentJobs.set(scheduleId, jobId);
}

/**
 * Obtiene el ID del job que se está ejecutando para un schedule dado.
 *
 * @param scheduleId - Identificador del schedule a consultar.
 * @returns El `jobId` del job en ejecución, o `undefined` si no hay ninguno.
 *
 * @edge-cases
 * - Retorna `undefined` si el scheduleId nunca fue registrado con `setCurrentJob`.
 */
export function getCurrentJob(scheduleId: string): string | undefined {
  return currentJobs.get(scheduleId);
}

/**
 * Elimina el registro del job en ejecución para un schedule.
 *
 * Llamar esto al finalizar un job (éxito o fallo) libera el schedule para que
 * pueda aceptar nuevas ejecuciones.
 *
 * @param scheduleId - Identificador del schedule cuyo job se desea limpiar.
 *
 * @edge-cases
 * - Si el scheduleId no tiene un job registrado, la operación es un no-op.
 */
export function clearCurrentJob(scheduleId: string): void {
  currentJobs.delete(scheduleId);
}

/**
 * Lista todos los jobs actualmente en ejecución con sus schedule IDs asociados.
 *
 * Útil para diagnóstico y monitoreo: muestra qué schedules están ocupados
 * en este momento.
 *
 * @returns Array de objetos `{ scheduleId, jobId }` representando cada job activo.
 *   Retorna un array vacío si no hay jobs en ejecución.
 *
 * @edge-cases
 * - El orden del array no tiene garantía de ordenación.
 */
export function listCurrentJobs(): Array<{ scheduleId: string; jobId: string }> {
  return Array.from(currentJobs.entries()).map(([scheduleId, jobId]) => ({ scheduleId, jobId }));
}
