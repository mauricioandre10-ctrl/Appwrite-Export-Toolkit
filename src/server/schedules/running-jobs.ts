const currentJobs = new Map<string, string>();

/** Registra el job actualmente en ejecución para un schedule dado. */
export function setCurrentJob(scheduleId: string, jobId: string): void {
  currentJobs.set(scheduleId, jobId);
}

/** Obtiene el ID del job que se está ejecutando para un schedule, o undefined si no hay ninguno. */
export function getCurrentJob(scheduleId: string): string | undefined {
  return currentJobs.get(scheduleId);
}

/** Elimina el registro del job en ejecución para un schedule. */
export function clearCurrentJob(scheduleId: string): void {
  currentJobs.delete(scheduleId);
}

/** Lista todos los jobs actualmente en ejecución con sus schedule IDs asociados. */
export function listCurrentJobs(): Array<{ scheduleId: string; jobId: string }> {
  return Array.from(currentJobs.entries()).map(([scheduleId, jobId]) => ({ scheduleId, jobId }));
}
