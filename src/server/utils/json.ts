/**
 * Serializa un valor a JSON con sangría (2 espacios) y al final de línea.
 */
export function stringifyJson(value: unknown): string {
  return `${JSON.stringify(value, bigintReplacer, 2)}\n`;
}

/**
 * Serializa un valor a una línea de JSON (NDJSON), sin sangría, listo para append de registros.
 */
export function stringifyNdjson(value: unknown): string {
  return `${JSON.stringify(value, bigintReplacer)}\n`;
}

function bigintReplacer(_key: string, value: unknown): unknown {
  return typeof value === "bigint" ? value.toString() : value;
}
