import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { stringifyNdjson } from "../utils/json";

/**
 * Escribe una lista de filas en un archivo NDJSON, creando el directorio padre si no existe.
 *
 * Cada elemento del array se serializa como una línea JSON independiente (formato NDJSON).
 * Si el array está vacío, se crea el archivo vacío. El directorio se crea con
 * `recursive: true` para soportar paths con subdirectorios anidados.
 *
 * @param filePath - Ruta absoluta o relativa del archivo NDJSON a escribir.
 * @param rows - Array de objetos a serializar. Cada elemento se convierte en una línea JSON.
 *
 * @errors
 * - Lanza excepción si falla la creación del directorio o la escritura del archivo.
 *
 * @edge-cases
 * - Si el archivo ya existe, se sobrescribe completamente (no append).
 * - Un array vacío genera un archivo vacío.
 */
export async function writeNdjson(filePath: string, rows: readonly unknown[]): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, rows.map((row) => stringifyNdjson(row)).join(""), "utf8");
}
