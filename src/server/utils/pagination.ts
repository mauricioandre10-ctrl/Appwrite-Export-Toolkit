import { Query } from "node-appwrite";

import { withRetry } from "./retry";

/**
 * Tipo genérico que representa la respuesta paginada de una API de Appwrite (campo dinámico + total).
 */
export type AppwriteListResponse<TKey extends string, TItem> = {
  total: number;
} & Record<TKey, TItem[]>;

/**
 * Recorre todas las páginas de una lista de Appwrite y devuelve todos los registros juntos en un solo array.
 *
 * Utiliza {@link paginateRows} internamente para iterar las páginas. Acumula todos los
 * registros en un único array, lo cual puede consumir mucha memoria si el conjunto de datos
 * es muy grande. Usar {@link paginateRows} directamente si se necesita procesar en streaming.
 *
 * @typeParam TKey - Nombre de la clave que contiene los items en la respuesta de Appwrite
 *   (por ejemplo, `"documents"`, `"files"`).
 * @typeParam TItem - Tipo de cada item retornado por la API.
 * @param key - Nombre de la propiedad en la respuesta que contiene el array de items.
 * @param list - Función que ejecuta la consulta paginada contra Appwrite. Recibe un array
 *   de queries (strings serializados de `Query.limit()` y `Query.offset()`).
 * @param options - Opciones de paginación.
 * @param options.limit - Cantidad de registros por página (default: 100).
 * @param options.safetyLimit - Límite máximo acumulativo de registros antes de abortar (default: 100000).
 * @returns Un objeto con `total` (total de registros según la API) y `rows` (array con todos
 *   los registros acumulados de todas las páginas).
 * @throws {Error} Si se supera el `safetyLimit` durante la paginación.
 */
export async function listAll<TKey extends string, TItem>(
  key: TKey,
  list: (queries: string[]) => Promise<AppwriteListResponse<TKey, TItem>>,
  options: { limit?: number; safetyLimit?: number } = {},
): Promise<{ total: number; rows: TItem[] }> {
  const rows: TItem[] = [];
  let total = 0;

  for await (const page of paginateRows(key, list, options)) {
    total = page.total;
    rows.push(...page.rows);
  }

  return { total, rows };
}

/**
 * Generador asíncrono que pagina una lista de Appwrite, devolviendo lotes de registros uno por uno.
 *
 * Cada lote contiene un `total` (total de registros según la API) y un array `rows` con los
 * registros de esa página. La paginación usa offset/limit y se detiene cuando la cantidad de
 * registros en un lote es menor al `limit` (indicando la última página) o cuando se supera
 * el `safetyLimit`.
 *
 * @typeParam TKey - Nombre de la clave que contiene los items en la respuesta de Appwrite.
 * @typeParam TItem - Tipo de cada item retornado por la API.
 * @param key - Nombre de la propiedad en la respuesta que contiene el array de items.
 * @param list - Función que ejecuta la consulta paginada contra Appwrite. Recibe un array
 *   de queries serializados.
 * @param options - Opciones de paginación.
 * @param options.limit - Cantidad de registros por página (default: 100).
 * @param options.safetyLimit - Límite máximo acumulativo de registros antes de abortar (default: 100000).
 * @yields Objetos `{ total, rows }` representando cada lote de registros.
 * @throws {Error} Si se supera el `safetyLimit` después de procesar más registros que el límite.
 *
 * @example
 * ```ts
 * for await (const page of paginateRows("documents", listFn, { limit: 200 })) {
 *   console.log(`Procesando ${page.rows.length} registros (total: ${page.total})`);
 * }
 * ```
 */
export async function* paginateRows<TKey extends string, TItem>(
  key: TKey,
  list: (queries: string[]) => Promise<AppwriteListResponse<TKey, TItem>>,
  options: { limit?: number; safetyLimit?: number } = {},
): AsyncGenerator<{ total: number; rows: TItem[] }> {
  const limit = options.limit ?? 100;
  const safetyLimit = options.safetyLimit ?? 100_000;
  let offset = 0;

  while (true) {
    const response = await withRetry(() => list([Query.limit(limit), Query.offset(offset)]));
    const batch = response[key] ?? [];
    yield { total: response.total ?? offset + batch.length, rows: batch };

    if (batch.length < limit) {
      return;
    }

    offset += limit;

    if (offset > safetyLimit) {
      throw new Error(`Pagination safety limit exceeded after ${offset} records`);
    }
  }
}
