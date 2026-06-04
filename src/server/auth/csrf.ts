import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";

const CSRF_SECRET = process.env.APP_CSRF_SECRET ?? process.env.APP_LOGIN_PASSWORD ?? "csrf-fallback-secret";
const TOKEN_MAX_AGE_MS = 60 * 60 * 1000; // 1 hour

/**
 * Stateless CSRF token: HMAC(sessionId + timestamp, secret)
 * No cookie needed. Token is generated server-side and validated on submission.
 */
export function generateCsrfToken(sessionToken: string): string {
  const timestamp = Date.now().toString();
  const payload = `${sessionToken}:${timestamp}`;
  const signature = createHmac("sha256", CSRF_SECRET).update(payload).digest("hex");
  return `${timestamp}:${signature}`;
}

/**
 * Obtiene un token CSRF válido a partir de la sesión del usuario actual.
 * @returns Token CSRF o null si no hay sesión activa.
 */
export async function getCsrfToken(): Promise<string | null> {
  try {
    const cookieStore = await cookies();
    const sessionToken = cookieStore.get("appwrite_export_toolkit_session")?.value;
    if (!sessionToken) {
      return null;
    }
    return generateCsrfToken(sessionToken);
  } catch {
    return null;
  }
}

/**
 * Valida un token CSRF verificando su firma HMAC y que no haya expirado.
 * @param token - Token CSRF a validar.
 * @returns true si el token es válido, false en caso contrario.
 */
export async function validateCsrfToken(token: string | null | undefined): Promise<boolean> {
  if (!token) {
    return false;
  }

  const parts = token.split(":");
  if (parts.length !== 2) {
    return false;
  }

  const [timestampStr, submittedSignature] = parts;
  if (!timestampStr || !submittedSignature) {
    return false;
  }

  // Verify timestamp is not expired
  const tokenTime = parseInt(timestampStr, 10);
  if (isNaN(tokenTime)) {
    return false;
  }
  const now = Date.now();
  if (now - tokenTime > TOKEN_MAX_AGE_MS) {
    return false;
  }

  // Get session token from cookie
  const cookieStore = await cookies();
  const sessionToken = cookieStore.get("appwrite_export_toolkit_session")?.value;
  if (!sessionToken) {
    return false;
  }

  // Re-compute expected signature
  const payload = `${sessionToken}:${timestampStr}`;
  const expectedSignature = createHmac("sha256", CSRF_SECRET).update(payload).digest("hex");

  // Timing-safe comparison
  const tokenBuffer = Buffer.from(submittedSignature, "hex");
  const expectedBuffer = Buffer.from(expectedSignature, "hex");

  if (tokenBuffer.length !== expectedBuffer.length) {
    return false;
  }

  return timingSafeEqual(tokenBuffer, expectedBuffer);
}

/**
 * Extrae el token CSRF de una request HTTP buscando en body (form o JSON) o header.
 * @param request - Request HTTP entrante.
 * @returns Token CSRF encontrado o null si no existe.
 */
export async function getCsrfTokenFromRequest(request: Request): Promise<string | null> {
  const contentType = request.headers.get("content-type") || "";

  if (contentType.includes("application/x-www-form-urlencoded") || contentType.includes("multipart/form-data")) {
    try {
      const clonedRequest = request.clone();
      const formData = await clonedRequest.formData();
      const token = formData.get("csrf_token");
      if (typeof token === "string") {
        return token;
      }
    } catch {
      // Fall through to header check
    }
  }

  if (contentType.includes("application/json")) {
    try {
      const clonedRequest = request.clone();
      const body = await clonedRequest.json() as Record<string, unknown>;
      if (typeof body.csrf_token === "string") {
        return body.csrf_token;
      }
    } catch {
      // Fall through to header check
    }
  }

  const headerToken = request.headers.get("x-csrf-token");
  if (headerToken) {
    return headerToken;
  }

  return null;
}
