import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { isValidSessionToken, sessionCookieName } from "@/server/auth/session";
import { validateCsrfToken, getCsrfTokenFromRequest } from "@/server/auth/csrf";
import { createJobId, createJob, updateJob } from "@/server/import/progress-store";

export const dynamic = "force-dynamic";

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
