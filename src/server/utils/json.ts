export function stringifyJson(value: unknown): string {
  return `${JSON.stringify(value, bigintReplacer, 2)}\n`;
}

export function stringifyNdjson(value: unknown): string {
  return `${JSON.stringify(value, bigintReplacer)}\n`;
}

function bigintReplacer(_key: string, value: unknown): unknown {
  return typeof value === "bigint" ? value.toString() : value;
}
