import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { isValidSessionToken, sessionCookieName } from "@/server/auth/session";
import { validateCsrfToken, getCsrfTokenFromRequest } from "@/server/auth/csrf";
import { createJobId, createJob, updateJob } from "@/server/import/progress-store";

export const dynamic = "force-dynamic";

/**
 * Lanza una tarea de exportación de datos de Appwrite y devuelve el ID del trabajo creado.
 *
 * Crea un job en el progress-store con el módulo solicitado (por defecto "all").
 * El cliente puede consultar el progreso mediante /api/jobs/{jobId} o suscribirse
 * al stream SSE en /api/jobs/{jobId}/stream.
 *
 * @param request - Request con un body JSON opcional: `{ module?: string }`.
 *   Si no se provee `module`, se exportan todos los módulos.
 * @returns JSON con `{ jobId: string, module: string }` y status 200.
 *
 * @requires_auth - Requiere un token de sesión válido en la cookie de sesión.
 * @requires_csrf - El token CSRF debe incluirse en la request y pasar la validación.
 *
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

  let body: { module?: string };
  try {
    body = (await request.json()) as { module?: string };
  } catch {
    body = {};
  }

  const moduleName = body.module ?? "all";
  const jobId = await createJobId("export");
  await createJob(jobId, "export");
  await updateJob(jobId, { module: moduleName });

  return NextResponse.json({ jobId, module: moduleName });
}
