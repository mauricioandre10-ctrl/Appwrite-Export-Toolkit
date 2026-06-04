import type { JsonObject } from "./types";

const sensitiveKeys = new Set([
  "password",
  "hash",
  "hashOptions",
  "credentials",
  "serviceAccountJSON",
  "authKey",
  "privateKey",
  "certificate",
]);

/**
 * Recorre un objeto de forma recursiva y reemplaza los campos sensibles por `"[redacted]"`.
 *
 * Los campos sensibles reconocidos son: `password`, `hash`, `hashOptions`, `credentials`,
 * `serviceAccountJSON`, `authKey`, `privateKey` y `certificate`. Si el valor de un campo
 * sensible es exactamente `false` o `null`, se preserva el valor original (no se redacta).
 *
 * Maneja arrays aplicando la redacción a cada elemento. Los valores primitivos y `undefined`
 * se devuelven tal cual. Los objetos se recorren recursivamente creando nuevas copias (no muta
 * el objeto original).
 *
 * @param value - Valor a sanitizar. Puede ser un objeto, array, primitivo o `undefined`.
 * @returns Una copia sanitizada del valor con los campos sensibles reemplazados. Si el input
 *   es un array, retorna un nuevo array sanitizado. Si es un primitivo, retorna el mismo valor.
 *
 * @example
 * ```ts
 * const clean = omitSensitiveFields({
 *   name: "test",
 *   password: "secret123",
 *   config: { privateKey: "key-value", host: "localhost" },
 * });
 * // { name: "test", password: "[redacted]", config: { privateKey: "[redacted]", host: "localhost" } }
 * ```
 */
export function omitSensitiveFields(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => omitSensitiveFields(item));
  }

  if (!isObject(value)) {
    return value;
  }

  const output: JsonObject = {};

  for (const [key, nestedValue] of Object.entries(value)) {
    if (sensitiveKeys.has(key) && nestedValue !== false && nestedValue !== null) {
      output[key] = "[redacted]";
      continue;
    }

    output[key] = omitSensitiveFields(nestedValue);
  }

  return output;
}

/**
 * Type guard que verifica si un valor es un objeto JSON (no null ni array).
 *
 * Aunque TypeScript infiere `typeof null === "object"`, esta función excluye
 * `null` explícitamente. Los arrays también se excluyen porque en el contexto
 * de sanitización se procesan por separado.
 *
 * @param value - Valor a verificar.
 * @returns `true` si el valor es un objeto plano (no null, no array).
 *
 * @edge-cases
 * - `typeof null === "object"` pero retorna `false`.
 * - `typeof [] === "object"` pero retorna `false`.
 * - `typeof new Date() === "object"` retorna `true` (no valida el tipo exacto).
 */
export function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null;
}
