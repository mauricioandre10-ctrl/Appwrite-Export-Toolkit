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

/** Recorre un objeto y reemplaza los campos sensibles (password, hash, privateKey, etc.) por "[redacted]". */
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

/** Type guard que verifica si un valor es un objeto JSON (no null ni array). */
export function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null;
}
