import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { isValidSessionToken, sessionCookieName } from "@/server/auth/session";
import { validateCsrfToken, getCsrfTokenFromRequest } from "@/server/auth/csrf";
import { createJob, createJobId, updateJob } from "@/server/import/progress-store";
import { acquireLock, releaseLock } from "@/server/schedules/lock";
import { appendRun } from "@/server/schedules/storage";
import { runScheduledExport } from "@/server/schedules/schedule-runner";
import { setCurrentJob } from "@/server/schedules/running-jobs";
import { logger } from "@/server/utils/logger";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string }> };

/**
 * Ejecuta manualmente un schedule de exportación y devuelve el jobId asignado.
 *
 * @param request - Request HTTP (no se usa body).
 * @param context - Contexto de la ruta con el parámetro `id` del schedule.
 * @returns JSON con el `jobId` asignado y estado 202, o un error si el schedule no existe o ya está corriendo.
 */
export async function POST(request: Request, context: RouteContext): Promise<NextResponse> {
  const cookieStore = await cookies();
  const sessionToken = cookieStore.get(sessionCookieName)?.value;

  if (!isValidSessionToken(sessionToken)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const csrfToken = await getCsrfTokenFromRequest(request);
  if (!(await validateCsrfToken(csrfToken))) {
    return NextResponse.json({ error: "CSRF validation failed" }, { status: 403 });
  }

  const { id } = await context.params;
  const { getSchedule } = await import("@/server/schedules/storage");
  const schedule = getSchedule(id);
  if (schedule === null) {
    return NextResponse.json({ error: "Schedule not found" }, { status: 404 });
  }

  if (!acquireLock(id)) {
    return NextResponse.json(
      { error: "Schedule is already running" },
      { status: 409 },
    );
  }

  // Pre-allocate the jobId so the client can subscribe to SSE immediately and the
  // running-job registry is populated before the export starts.
  const jobId = await createJobId("export");
  const startedAt = new Date();

  await createJob(jobId, "export");
  // Mark the job as "running" BEFORE the fire-and-forget so any client that
  // subscribes to the SSE stream sees status="running" and observes the runner
  // (via job-file polling) instead of starting its own duplicate export.
  // Without this, two simultaneous EventSource subscribers (card + feedback
  // banner) would each call exportBackup and create extra phantom backups.
  await updateJob(jobId, {
    status: "running",
    module: schedule.module,
    detail: `Manual run de "${schedule.name}"`,
  });
  appendRun(id, {
    ranAt: startedAt.toISOString(),
    status: "running",
    trigger: "manual",
    jobId,
  });
  setCurrentJob(id, jobId);

  // Fire-and-forget the export; the client watches the jobId in the SSE stream.
  void (async () => {
    try {
      const result = await runScheduledExport(schedule, "manual", { preAllocatedJobId: jobId });
      logger.info(
        { id, success: result.success, jobId: result.jobId, errorMessage: result.errorMessage },
        "Manual schedule run finished",
      );
    } catch (err) {
      logger.error(
        { id, jobId, err: err instanceof Error ? err.message : String(err) },
        "Manual schedule run crashed",
      );
    } finally {
      releaseLock(id);
    }
  })();

  return NextResponse.json(
    {
      status: "triggered",
      scheduleId: id,
      jobId,
      message: "Ejecución iniciada",
    },
    { status: 202 },
  );
}
