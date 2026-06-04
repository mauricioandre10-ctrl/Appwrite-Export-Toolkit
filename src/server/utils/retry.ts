/**
 * Opciones de configuración para el mecanismo de reintentos con backoff exponencial.
 */
export type RetryOptions = {
  attempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  shouldRetry?: (error: unknown) => boolean;
  onRetry?: (input: { attempt: number; delayMs: number; error: unknown }) => void | Promise<void>;
};

/**
 * Ejecuta una operación asíncrona con reintentos y backoff exponencial si ocurre un error transitorio.
 *
 * La fórmula de backoff es: `min(maxDelayMs, baseDelayMs * 2^(attempt - 1))`.
 * Por defecto: intento 1 = 300ms, intento 2 = 600ms, intento 3 = 1200ms (capped a 3000ms).
 *
 * @typeParam T - Tipo del valor retornado por la operación.
 * @param operation - Función asíncrona que se ejecuta en cada intento. Se invoca una vez
 *   adicional si todos los reintentos fallan (ya que el último intento también lanza).
 * @param options - Configuración del mecanismo de reintentos.
 * @param options.attempts - Número máximo de intentos (default: 3). Debe ser >= 1.
 * @param options.baseDelayMs - Delay base en milisegundos para el backoff (default: 300).
 * @param options.maxDelayMs - Delay máximo en milisegundos para el backoff (default: 3000).
 * @param options.shouldRetry - Predicate que decide si se reintenta dado un error.
 *   Si retorna `true`, se reintenta. Por defecto reintenta errores con códigos 408, 409,
 *   425, 429 o >= 500, y cualquier error sin código numérico.
 * @param options.onRetry - Callback que se ejecuta antes de cada espera, recibe el número
 *   de intento actual, el delay calculado y el error. Puede ser async.
 * @returns El resultado de la operación si tiene éxito en cualquier intento.
 * @throws {unknown} El último error capturado si se agotaron todos los reintentos, o el
 *   error original si `shouldRetry` retorna `false` para ese error.
 *
 * @example
 * ```ts
 * const data = await withRetry(() => fetch("/api/data"), {
 *   attempts: 5,
 *   baseDelayMs: 500,
 *   shouldRetry: (err) => isNetworkError(err),
 *   onRetry: ({ attempt, delayMs }) => console.log(`Reintento ${attempt}, espera ${delayMs}ms`),
 * });
 * ```
 */
export async function withRetry<T>(operation: () => Promise<T>, options: RetryOptions = {}): Promise<T> {
  const attempts = options.attempts ?? 3;
  const baseDelayMs = options.baseDelayMs ?? 300;
  const maxDelayMs = options.maxDelayMs ?? 3_000;
  const shouldRetry = options.shouldRetry ?? isRetryableError;

  let lastError: unknown;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;

      if (attempt >= attempts || !shouldRetry(error)) {
        throw error;
      }

      const delayMs = Math.min(maxDelayMs, baseDelayMs * 2 ** (attempt - 1));
      await options.onRetry?.({ attempt, delayMs, error });
      await sleep(delayMs);
    }
  }

  throw lastError;
}

function isRetryableError(error: unknown): boolean {
  if (!isObject(error)) {
    return true;
  }

  const code = typeof error.code === "number" ? error.code : undefined;

  if (code === undefined) {
    return true;
  }

  return code === 408 || code === 409 || code === 425 || code === 429 || code >= 500;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isObject(value: unknown): value is { code?: unknown } {
  return typeof value === "object" && value !== null;
}
