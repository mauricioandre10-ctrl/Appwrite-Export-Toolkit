import { PassThrough } from "node:stream";

import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import * as tar from "tar";

import { loadAppwriteConfig } from "@/server/appwrite/config";
import { resolveManagedBackupPath } from "@/server/backups/catalog";
import { isValidSessionToken, sessionCookieName } from "@/server/auth/session";
import { validateCsrfToken, getCsrfTokenFromRequest } from "@/server/auth/csrf";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{
    backupId: string;
  }>;
};

export async function POST(request: Request, context: RouteContext) {
  const cookieStore = await cookies();
  const sessionToken = cookieStore.get(sessionCookieName)?.value;

  if (!isValidSessionToken(sessionToken)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const csrfToken = await getCsrfTokenFromRequest(request);
  if (!(await validateCsrfToken(csrfToken))) {
    return NextResponse.json({ error: "CSRF validation failed" }, { status: 403 });
  }

  const { backupId } = await context.params;
  const config = loadAppwriteConfig();
  const backupRoot = resolveManagedBackupPath(config.BACKUP_OUTPUT_DIR, backupId);

  const passthrough = new PassThrough();

  tar
    .create(
      {
        cwd: backupRoot,
        gzip: true,
        portable: true,
      },
      ["."],
    )
    .pipe(passthrough);

  return new Response(passthrough as unknown as ReadableStream, {
    headers: {
      "Content-Type": "application/gzip",
      "Content-Disposition": `attachment; filename="${backupId}.tar.gz"`,
      "Cache-Control": "no-store",
    },
  });
}
