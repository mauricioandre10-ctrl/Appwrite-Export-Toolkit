/**
 * Serializa un valor a JSON con sangría (2 espacios) y salto de línea final.
 *
 * Ideal para archivos de configuración, manifest y cualquier JSON que un humano
 * pueda leer. Los valores `bigint` se convierten automáticamente a string.
 *
 * @param value - Valor a serializar (objeto, array, primitivo).
 * @returns String con el JSON formateado, terminado en `\n`.
 *
 * @edge-cases
 * - `undefined` en un objeto se omite (comportamiento estándar de `JSON.stringify`).
 * - `bigint` se convierte a su representación decimal sin sufijo `n`.
 * - `null` se serializa como `null` (no se omite).
 */
export function stringifyJson(value: unknown): string {
  return `${JSON.stringify(value, bigintReplacer, 2)}\n`;
}

/**
 * Serializa un valor a una línea de JSON (NDJSON), sin sangría, listo para append de registros.
 *
 * Cada llamada produce exactamente una línea terminada en `\n`, lo que permite
 * construir archivos NDJSON concatenando múltiples invocaciones. Los valores
 * `bigint` se convierten automáticamente a string.
 *
 * @param value - Valor a serializar (objeto, array, primitivo).
 * @returns String con una sola línea JSON terminada en `\n`.
 *
 * @edge-cases
 * - Un objeto con propiedades que contienen `\n` se escapa correctamente en el JSON.
 * - `undefined` en un objeto se omite (comportamiento estándar de `JSON.stringify`).
 */
export function stringifyNdjson(value: unknown): string {
  return `${JSON.stringify(value, bigintReplacer)}\n`;
}

function bigintReplacer(_key: string, value: unknown): unknown {
  return typeof value === "bigint" ? value.toString() : value;
}
