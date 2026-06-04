/**
 * Hook de instrumentación de Next.js: arranca el motor de schedules al iniciar el servidor Node.js.
 *
 * Se ejecuta una sola vez durante el cold start del servidor. Verifica que el runtime
 * sea Node.js (no Edge) y que el scheduler no esté deshabilitado por variable de entorno.
 * Si todo está correcto, importa dinámicamente el motor de schedules y lo arranca.
 *
 * @returns `Promise<void>` — no retorna valores; los errores se capturan y loguean.
 *
 * @errors
 * - Si la importación dinámica falla (módulo no encontrado), se loguea el error y se ignora.
 * - Si `bootstrap()` lanza excepción, se loguea y se ignora (el servidor sigue levantando).
 *
 * @edge-cases
 * - En runtime Edge (`NEXT_RUNTIME !== "nodejs"`) no hace nada.
 * - Si `SCHEDULER_DISABLED=1`, no arranca el motor de schedules.
 * - El import dinámico evita que los módulos de schedules se carguen en Edge runtime.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") {
    return;
  }

  if (process.env.SCHEDULER_DISABLED === "1") {
    return;
  }

  try {
    const { bootstrap } = await import("./server/schedules/scheduler-engine");
    const { getSchedulesDir } = await import("./server/schedules/storage");
    bootstrap();
    console.log(`[instrumentation] Schedules dir: ${getSchedulesDir()}`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[instrumentation] Failed to bootstrap schedules: ${message}`);
  }
}
