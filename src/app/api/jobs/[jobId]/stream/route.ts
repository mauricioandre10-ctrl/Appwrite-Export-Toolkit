import { cookies } from "next/headers";

import { isValidSessionToken, sessionCookieName } from "@/server/auth/session";
import { getJob } from "@/server/import/progress-store";
import { streamJob } from "@/server/jobs/job-streamer";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Devuelve un stream Server-Sent Events (SSE) con los eventos de progreso de un job.
 *
 * Mantiene una conexión abierta que emite eventos de tipo `event` con datos
 * JSON que reflejan el progreso en tiempo real (avance, módulos procesados,
 * errores, etc.). El stream se cierra automáticamente cuando el job finaliza.
 *
 * @param _request - Request HTTP (no se usa el body).
 * @param params - Parámetros de ruta con `jobId` (identificador del job).
 * @returns Stream SSE (`text/event-stream`) con eventos de progreso en tiempo real.
 *   Cada evento tiene la forma: `event: <tipo>\ndata: <JSON>\n\n`.
 *
 * @requires_auth - Requiere un token de sesión válido en la cookie de sesión.
 *   No requiere CSRF ya que es solo lectura (GET).
 *
 * @error 401 - No se proporcionó un token de sesión válido (response JSON, no SSE).
 * @error 404 - No se encontró un job con el `jobId` dado (response JSON, no SSE).
 * @error 500 - Error inesperado durante el streaming (emite evento `error-event` antes de cerrar).
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ jobId: string }> },
) {
  const cookieStore = await cookies();
  const sessionToken = cookieStore.get(sessionCookieName)?.value;

  if (!isValidSessionToken(sessionToken)) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  const { jobId } = await params;
  const job = await getJob(jobId);

  if (job === undefined) {
    return new Response(JSON.stringify({ error: "Job not found" }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  }

  const encoder = new TextEncoder();
  let closed = false;

  const stream = new ReadableStream({
    async start(controller) {
      function sendSSE(event: string, data: string) {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${data}\n\n`));
        } catch {
          closed = true;
        }
      }

      try {
        await streamJob(jobId, job, (event, data) => {
          sendSSE(event, JSON.stringify(data));
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Unknown error";
        sendSSE("error-event", JSON.stringify({ jobId, error: msg }));
      } finally {
        if (!closed) {
          closed = true;
          try {
            controller.close();
          } catch {
            // already closed
          }
        }
      }
    },
    cancel() {
      closed = true;
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
