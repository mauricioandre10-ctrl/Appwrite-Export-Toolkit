import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { isValidSessionToken, sessionCookieName } from "@/server/auth/session";
import { getJob } from "@/server/import/progress-store";

export const dynamic = "force-dynamic";

/**
 * Devuelve el estado actual de un job (exportación o importación).
 *
 * Consulta el progress-store y retorna el objeto del job con su progreso,
 * módulo asociado, resultado parcial y demás metadatos.
 *
 * @param _request - Request HTTP (no se usa el body).
 * @param params - Parámetros de ruta con `jobId` (identificador del job).
 * @returns JSON con el objeto del job (campos: `type`, `module`, `status`,
 *   `result`, `startedAt`, `finishedAt`, etc.) y status 200.
 *
 * @requires_auth - Requiere un token de sesión válido en la cookie de sesión.
 *   No requiere CSRF ya que es solo lectura (GET).
 *
 * @error 401 - No se proporcionó un token de sesión válido.
 * @error 404 - No se encontró un job con el `jobId` dado.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ jobId: string }> },
) {
  const cookieStore = await cookies();
  const sessionToken = cookieStore.get(sessionCookieName)?.value;

  if (!isValidSessionToken(sessionToken)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { jobId } = await params;
  const job = await getJob(jobId);

  if (job === undefined) {
    return NextResponse.json({ error: "Job not found" }, { status: 404 });
  }

  return NextResponse.json(job);
}
