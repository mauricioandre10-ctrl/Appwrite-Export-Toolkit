import { createHash, timingSafeEqual } from "node:crypto";
import pino from "pino";

const sessionLogger = pino({ level: process.env.LOG_LEVEL ?? "info" });

/** Nombre de la cookie que almacena el token de sesión del usuario. */
export const sessionCookieName = "appwrite_export_toolkit_session";

/** Configuración de login con credenciales y estado de disponibilidad. */
export type LoginConfig = {
  ready: boolean;
  user: string;
  password: string;
};

/**
 * Lee las credenciales de login desde las variables de entorno.
 * @returns Configuración de login con usuario, password y si están disponibles.
 */
export function getLoginConfig(): LoginConfig {
  const user = process.env.APP_LOGIN_USER ?? "";
  const password = process.env.APP_LOGIN_PASSWORD ?? "";

  if (user.length === 0 || password.length === 0) {
    sessionLogger.warn(
      "APP_LOGIN_USER and APP_LOGIN_PASSWORD must be set. Login is disabled until configured.",
    );
  }

  return {
    ready: user.length > 0 && password.length > 0,
    user,
    password,
  };
}

/**
 * Genera un token de sesión hasheando las credenciales con SHA-256.
 * @param user - Nombre de usuario.
 * @param password - Contraseña del usuario.
 * @returns Token de sesión en formato hexadecimal.
 */
export function createSessionToken(user: string, password: string): string {
  return createHash("sha256").update(`${user}:${password}`).digest("hex");
}

/**
 * Verifica si un token de sesión coincide con las credenciales configuradas.
 * @param token - Token de sesión a validar.
 * @param config - Configuración de login (opcional, se obtiene por defecto de env vars).
 * @returns true si el token es válido, false en caso contrario.
 */
export function isValidSessionToken(token: string | undefined, config = getLoginConfig()): boolean {
  if (!config.ready || !token) {
    return false;
  }
  const expectedToken = createSessionToken(config.user, config.password);
  const tokenBuffer = Buffer.from(token, "utf8");
  const expectedBuffer = Buffer.from(expectedToken, "utf8");
  if (tokenBuffer.length !== expectedBuffer.length) {
    return false;
  }
  return timingSafeEqual(tokenBuffer, expectedBuffer);
}

/**
 * Compara dos strings de forma segura contra timing attacks usando SHA-256.
 * @param input - Valor a comparar.
 * @param expected - Valor esperado.
 * @returns true si ambos valores son equivalentes, false en caso contrario.
 */
export function safeEqual(input: string, expected: string): boolean {
  const inputHash = createHash("sha256").update(input).digest();
  const expectedHash = createHash("sha256").update(expected).digest();

  return timingSafeEqual(inputHash, expectedHash);
}
