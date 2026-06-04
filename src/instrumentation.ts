/**
 * Hook de instrumentación de Next.js: arranca el motor de schedules al iniciar el servidor Node.js.
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
