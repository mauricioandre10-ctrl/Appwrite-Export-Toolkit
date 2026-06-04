import { Cron } from "croner";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { isValidSessionToken, sessionCookieName } from "@/server/auth/session";
import { validateCsrfToken, getCsrfTokenFromRequest } from "@/server/auth/csrf";
import { getNextRun, register as registerSchedule } from "@/server/schedules/scheduler-engine";
import { getCurrentJob } from "@/server/schedules/running-jobs";
import { createSchedule, getSchedule, listScheduleSummaries } from "@/server/schedules/storage";
import { scheduleInputSchema, type Schedule, type ScheduleSummary } from "@/server/schedules/types";

export const dynamic = "force-dynamic";

type ScheduleSummaryWithNext = Omit<ScheduleSummary, "nextRunAt"> & {
  nextRunAt: string | undefined;
  currentRunJobId: string | undefined;
};

function toEnrichedSummary(schedule: Schedule): ScheduleSummaryWithNext {
  const next = getNextRun(schedule);
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
    nextRunAt: next,
    currentRunJobId: getCurrentJob(schedule.id),
  };
}

function enrichListSummary(summary: ScheduleSummary): ScheduleSummaryWithNext {
  const full = getSchedule(summary.id);
  if (full === null) {
    return { ...summary, nextRunAt: undefined, currentRunJobId: undefined };
  }
  return toEnrichedSummary(full);
}

function validateCron(expression: string, timezone: string): string | null {
  try {
    new Cron(expression, { timezone });
    return null;
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
}

/**
 * Devuelve la lista de todos los schedules configurados con su próximo run calculado.
 *
 * Cada schedule incluye el `currentRunJobId` si hay un job en ejecución en este momento.
 * La respuesta se enriquece calculando `nextRunAt` a partir de la expresión cron.
 *
 * @returns JSON con `{ schedules: ScheduleSummaryWithNext[] }`.
 *
 * @errors
 * - `401 Unauthorized` si el token de sesión no es válido o no está presente.
 */
export async function GET(): Promise<NextResponse> {
  const cookieStore = await cookies();
  const sessionToken = cookieStore.get(sessionCookieName)?.value;

  if (!isValidSessionToken(sessionToken)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const summaries = listScheduleSummaries().map(enrichListSummary);
  return NextResponse.json({ schedules: summaries });
}

/**
 * Crea un nuevo schedule de exportación con la expresión cron y configuración dada.
 *
 * Valida el body contra `scheduleInputSchema`, verifica que la expresión cron sea válida
 * con la timezone indicada, y opcionalmente registra el schedule en el motor de cron
 * si `enabled` es `true`.
 *
 * @param request - Request HTTP con un JSON body que cumple `ScheduleInputSchema`.
 * @returns JSON con `{ schedule: ScheduleSummaryWithNext }` y status 201 al crear.
 *
 * @errors
 * - `400` si el body no es JSON válido o no pasa la validación del schema.
 * - `400` si la expresión cron o timezone son inválidas.
 * - `403` si falla la validación CSRF.
 * - `401` si no hay sesión válida.
 * - `500` si el registro en el motor de schedules falla.
 */
export async function POST(request: Request): Promise<NextResponse> {
  const cookieStore = await cookies();
  const sessionToken = cookieStore.get(sessionCookieName)?.value;

  if (!isValidSessionToken(sessionToken)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const csrfToken = await getCsrfTokenFromRequest(request);
  if (!(await validateCsrfToken(csrfToken))) {
    return NextResponse.json({ error: "CSRF validation failed" }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = scheduleInputSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  const cronError = validateCron(parsed.data.cronExpression, parsed.data.timezone);
  if (cronError !== null) {
    return NextResponse.json(
      { error: "Invalid cron expression", detail: cronError },
      { status: 400 },
    );
  }

  const created = createSchedule(parsed.data);

  if (created.enabled) {
    const ok = registerSchedule(created);
    if (!ok) {
      return NextResponse.json(
        { error: "Failed to register schedule in engine" },
        { status: 500 },
      );
    }
  }

  return NextResponse.json({ schedule: toEnrichedSummary(created) }, { status: 201 });
}

/**
 * Endpoint PATCH no soportado en la ruta de colección.
 *
 * Redirige al usuario a usar `/api/schedules/[id]` para operaciones de actualización.
 *
 * @returns Siempre devuelve 405 Method Not Allowed.
 */
export async function PATCH(): Promise<NextResponse> {
  return NextResponse.json(
    { error: "PATCH not allowed on collection endpoint; use /api/schedules/[id]" },
    { status: 405 },
  );
}
