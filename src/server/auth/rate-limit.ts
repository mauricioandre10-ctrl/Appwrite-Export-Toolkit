/**
 * Rate limiting en memoria para protección contra fuerza bruta.
 *
 * Limita intentos de login por IP. Cuando se alcanza el máximo de
 * intentos fallidos, la IP queda bloqueada por un período configurable.
 *
 * Se pierde estado al reiniciar el servidor (suficiente para una app
 * self-hosted con un solo usuario).
 */

type RateLimitEntry = {
  attempts: number;
  blockedUntil: number;
};

const attempts = new Map<string, RateLimitEntry>();

const MAX_ATTEMPTS = 5;
const WINDOW_MS = 15 * 60 * 1000; // 15 minutos

/**
 * Verifica si una IP está bloqueada por exceso de intentos fallidos.
 * @param ip - Dirección IP del cliente.
 * @returns true si la IP está bloqueada, false si puede continuar.
 */
export function isRateLimited(ip: string): boolean {
  const entry = attempts.get(ip);
  if (!entry) {
    return false;
  }
  if (Date.now() < entry.blockedUntil) {
    return true;
  }
  attempts.delete(ip);
  return false;
}

/**
 * Registra un intento fallido para una IP.
 * Si se alcanza el máximo, bloquea la IP por WINDOW_MS.
 * @param ip - Dirección IP del cliente.
 */
export function recordFailedAttempt(ip: string): void {
  const entry = attempts.get(ip);
  if (!entry) {
    attempts.set(ip, { attempts: 1, blockedUntil: 0 });
    return;
  }
  entry.attempts += 1;
  if (entry.attempts >= MAX_ATTEMPTS) {
    entry.blockedUntil = Date.now() + WINDOW_MS;
  }
}

/**
 * Resetea el contador de intentos para una IP (llamar tras login exitoso).
 * @param ip - Dirección IP del cliente.
 */
export function resetAttempts(ip: string): void {
  attempts.delete(ip);
}

// --- Rate limiting por sesión para rutas API ---

type SessionLimitEntry = {
  count: number;
  resetAt: number;
};

const sessionLimits = new Map<string, SessionLimitEntry>();

const API_MAX_REQUESTS = 10;
const API_WINDOW_MS = 60 * 1000; // 1 minuto

/**
 * Verifica si una sesión ha excedido el límite de requests por ventana de tiempo.
 * @param sessionToken - Token de sesión del usuario.
 * @returns true si la sesión está limitada, false si puede continuar.
 */
export function isSessionRateLimited(sessionToken: string): boolean {
  const entry = sessionLimits.get(sessionToken);
  if (!entry) {
    return false;
  }
  if (Date.now() > entry.resetAt) {
    sessionLimits.delete(sessionToken);
    return false;
  }
  return entry.count >= API_MAX_REQUESTS;
}

/**
 * Incrementa el contador de requests para una sesión.
 * @param sessionToken - Token de sesión del usuario.
 */
export function recordSessionRequest(sessionToken: string): void {
  const entry = sessionLimits.get(sessionToken);
  if (!entry || Date.now() > entry.resetAt) {
    sessionLimits.set(sessionToken, { count: 1, resetAt: Date.now() + API_WINDOW_MS });
    return;
  }
  entry.count += 1;
}
