import { cookies } from "next/headers";

import { isValidSessionToken, sessionCookieName } from "@/server/auth/session";
import { getJob } from "@/server/import/progress-store";
import { streamJob } from "@/server/jobs/job-streamer";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Devuelve un stream SSE con los eventos de progreso de un job de importación. */
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
