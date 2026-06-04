import { Cron } from "croner";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { isValidSessionToken, sessionCookieName } from "@/server/auth/session";
import { validateCsrfToken, getCsrfTokenFromRequest } from "@/server/auth/csrf";
import { deleteSchedule, getSchedule, updateSchedule } from "@/server/schedules/storage";
import { refreshAfterPatch, unregister } from "@/server/schedules/scheduler-engine";
import { schedulePatchSchema } from "@/server/schedules/types";
import { logger } from "@/server/utils/logger";

export const dynamic = "force-dynamic";

/** Valida una expresión cron devolviendo null si es válida o el mensaje de error si no lo es. */
function validateCron(expression: string, timezone: string): string | null {
  try {
    new Cron(expression, { timezone });
    return null;
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
}

type RouteContext = { params: Promise<{ id: string }> };

/** Actualiza los campos de un schedule existente (cron, timezone, nombre, módulo, etc.). */
export async function PATCH(request: Request, context: RouteContext): Promise<NextResponse> {
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
  const existing = getSchedule(id);
  if (existing === null) {
    return NextResponse.json({ error: "Schedule not found" }, { status: 404 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = schedulePatchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  const nextCron = parsed.data.cronExpression ?? existing.cronExpression;
  const nextTz = parsed.data.timezone ?? existing.timezone;
  const cronError = validateCron(nextCron, nextTz);
  if (cronError !== null) {
    return NextResponse.json(
      { error: "Invalid cron expression", detail: cronError },
      { status: 400 },
    );
  }

  const updated = updateSchedule(id, parsed.data);
  if (updated === null) {
    return NextResponse.json({ error: "Failed to update schedule" }, { status: 500 });
  }

  try {
    refreshAfterPatch(id);
  } catch (err) {
    logger.error(
      { id, err: err instanceof Error ? err.message : String(err) },
      "Failed to refresh schedule in engine after patch",
    );
  }

  return NextResponse.json({ schedule: updated });
}

/** Elimina un schedule y lo desregistra del motor de cron. */
export async function DELETE(request: Request, context: RouteContext): Promise<NextResponse> {
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
  const existing = getSchedule(id);
  if (existing === null) {
    return NextResponse.json({ error: "Schedule not found" }, { status: 404 });
  }

  unregister(id);
  const ok = deleteSchedule(id);
  if (!ok) {
    return NextResponse.json({ error: "Failed to delete schedule file" }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}

/** POST no-op; redirige al cliente a usar POST /api/schedules/[id]/run. */
export async function POST(_request: Request, context: RouteContext): Promise<NextResponse> {
  // POST on a single schedule is a no-op; exists to avoid 404 when client retries.
  const { id } = await context.params;
  return NextResponse.json(
    { error: "Use POST /api/schedules/[id]/run to trigger a manual run", id },
    { status: 405 },
  );
}
