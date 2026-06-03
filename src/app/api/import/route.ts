import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { isValidSessionToken, sessionCookieName } from "@/server/auth/session";
import { createJobId, createJob, updateJob } from "@/server/import/progress-store";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const cookieStore = await cookies();
  const sessionToken = cookieStore.get(sessionCookieName)?.value;

  if (!isValidSessionToken(sessionToken)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
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
