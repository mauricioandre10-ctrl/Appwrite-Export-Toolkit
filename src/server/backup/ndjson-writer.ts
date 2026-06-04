import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { stringifyNdjson } from "../utils/json";

/** Escribe una lista de filas en un archivo NDJSON, creando el directorio si no existe. */
export async function writeNdjson(filePath: string, rows: readonly unknown[]): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, rows.map((row) => stringifyNdjson(row)).join(""), "utf8");
}
