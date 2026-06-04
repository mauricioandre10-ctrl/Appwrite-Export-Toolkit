import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { isValidSessionToken, sessionCookieName } from "@/server/auth/session";
import { validateCsrfToken, getCsrfTokenFromRequest } from "@/server/auth/csrf";
import { createJobId, createJob, updateJob } from "@/server/import/progress-store";

export const dynamic = "force-dynamic";

/**
 * Lanza una tarea de importación desde un backup existente y devuelve el ID del trabajo.
 *
 * Crea un job en el progress-store asociado al backupId y módulo indicados.
 * El cliente puede consultar el progreso mediante /api/jobs/{jobId} o suscribirse
 * al stream SSE en /api/jobs/{jobId}/stream.
 *
 * @param request - Request con un body JSON: `{ backupId: string, module?: string }`.
 *   `backupId` es obligatorio. Si no se provee `module`, se importan todos los módulos.
 * @returns JSON con `{ jobId: string, backupId: string, module: string }` y status 200.
 *
 * @requires_auth - Requiere un token de sesión válido en la cookie de sesión.
 * @requires_csrf - El token CSRF debe incluirse en la request y pasar la validación.
 *
 * @error 400 - El campo `backupId` es obligatorio.
 * @error 401 - No se proporcionó un token de sesión válido.
 * @error 403 - El token CSRF no es válido.
 */
export async function POST(request: Request) {
  const cookieStore = await cookies();
  const sessionToken = cookieStore.get(sessionCookieName)?.value;

  if (!isValidSessionToken(sessionToken)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const csrfToken = await getCsrfTokenFromRequest(request);
  if (!(await validateCsrfToken(csrfToken))) {
    return NextResponse.json({ error: "CSRF validation failed" }, { status: 403 });
  }

  let body: { backupId?: string; module?: string };
  try {
    body = (await request.json()) as { backupId?: string; module?: string };
  } catch {
    body = {};
  }

  const backupId = body.backupId ?? "";
  const moduleName = body.module ?? "all";

  if (!backupId) {
    return NextResponse.json({ error: "backupId is required" }, { status: 400 });
  }

  const jobId = await createJobId("import");
  await createJob(jobId, "import");
  await updateJob(jobId, { module: moduleName, result: backupId });

  return NextResponse.json({ jobId, backupId, module: moduleName });
}
