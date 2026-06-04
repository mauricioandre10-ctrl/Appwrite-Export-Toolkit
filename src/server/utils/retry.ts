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
