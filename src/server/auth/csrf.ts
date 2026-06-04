import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";

const TOKEN_MAX_AGE_MS = 60 * 60 * 1000; // 1 hour

function getSecret(): string {
  const secret = process.env.APP_CSRF_SECRET;
  if (!secret) {
    throw new Error(
      "APP_CSRF_SECRET is required. Generate with: openssl rand -hex 32",
    );
  }
  return secret;
}

/**
 * Genera un token CSRF stateless firmado con HMAC-SHA256.
 *
 * El token no requiere almacenamiento en servidor ni cookies adicionales.
 * Se genera completamente server-side y se valida en cada submission.
 *
 * Formato del token: `timestamp:signature`
 * - `timestamp`: Unix timestamp en milisegundos (epoch) en base 10.
 * - `signature`: HMAC-SHA256 del payload `sessionToken:timestamp`, en hexadecimal.
 *
 * @param sessionToken - Token de sesión del usuario actual (cookie de Appwrite).
 * @returns Token CSRF en formato `"timestamp:signature"`.
 *
 * @example
 * ```ts
 * const token = generateCsrfToken("abc123");
 * // "1717500000000:a1b2c3d4..."
 * ```
 */
export function generateCsrfToken(sessionToken: string): string {
  const timestamp = Date.now().toString();
  const payload = `${sessionToken}:${timestamp}`;
  const signature = createHmac("sha256", getSecret()).update(payload).digest("hex");
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
  const expectedSignature = createHmac("sha256", getSecret()).update(payload).digest("hex");

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
