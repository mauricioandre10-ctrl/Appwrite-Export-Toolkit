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

/**
 * Descarga un backup existente como archivo comprimido `.tar.gz`.
 *
 * Valida que el directorio del backup exista en disco y crea un stream de
 * datos comprimidos con gzip. El archivo se descarga con el nombre `{backupId}.tar.gz`.
 *
 * @param request - Request HTTP. El body no se usa; el backupId se obtiene de la URL.
 * @param context - Contexto de ruta con `params.backupId` (identificador del backup).
 * @returns Stream binario (`application/gzip`) con el contenido del backup comprimido.
 *
 * @requires_auth - Requiere un token de sesión válido en la cookie de sesión.
 * @requires_csrf - El token CSRF debe incluirse en la request y pasar la validación.
 *
 * @error 401 - No se proporcionó un token de sesión válido.
 * @error 403 - El token CSRF no es válido.
 * @error 500 - Error al comprimir o enviar el archivo (directorios inexistentes, permisos, etc.).
 */
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
