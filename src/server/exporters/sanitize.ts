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

export function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null;
}
