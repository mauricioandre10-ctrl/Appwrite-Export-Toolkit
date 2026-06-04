import { createWriteStream } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { once } from "node:events";

import { stringifyJson, stringifyNdjson } from "../utils/json";

/**
 * Escritor de archivos para backups. Maneja la creación de directorios,
 * escritura de JSON, NDJSON y archivos binarios dentro del directorio raíz del backup.
 */
export class BackupWriter {
  constructor(private readonly rootDir: string) {}

  /**
   * Resuelve una ruta relativa contra el directorio raíz del backup,
   * validando que no haya intento de path traversal.
   *
   * @param relativePath - Ruta relativa a resolver dentro del directorio del backup.
   * @returns La ruta absoluta resultante.
   */
  resolvePath(relativePath: string): string {
    const resolved = path.resolve(this.rootDir, relativePath);
    if (!resolved.startsWith(this.rootDir)) {
      throw new Error(`Path traversal attempt blocked: ${relativePath}`);
    }
    return resolved;
  }

  /**
   * Asegura que un directorio exista dentro del backup, creándolo si es necesario.
   *
   * @param relativeDir - Ruta relativa del directorio a crear (por defecto ".").
   * @returns La ruta absoluta del directorio creado o existente.
   */
  async ensureDir(relativeDir = "."): Promise<string> {
    const dir = this.resolvePath(relativeDir);
    await mkdir(dir, { recursive: true });
    return dir;
  }

  /**
   * Escribe un valor como archivo JSON dentro del directorio del backup.
   *
   * @param relativePath - Ruta relativa del archivo a escribir.
   * @param value - Valor a serializar como JSON.
   * @returns La ruta absoluta del archivo escrito.
   */
  async writeJson(relativePath: string, value: unknown): Promise<string> {
    const filePath = this.resolvePath(relativePath);
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, stringifyJson(value), "utf8");
    return filePath;
  }

  /**
   * Escribe una lista de filas como archivo NDJSON (una línea por objeto).
   *
   * @param relativePath - Ruta relativa del archivo a escribir.
   * @param rows - Arreglo de filas a serializar en formato NDJSON.
   * @returns La ruta absoluta del archivo escrito.
   */
  async writeNdjson(relativePath: string, rows: readonly unknown[]): Promise<string> {
    const filePath = this.resolvePath(relativePath);
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, rows.map((row) => stringifyNdjson(row)).join(""), "utf8");
    return filePath;
  }

  /**
   * Escribe filas NDJSON de forma streaming, útil para datasets grandes.
   * La función callback recibe un emisor de filas que respeta el backpressure del stream.
   *
   * @param relativePath - Ruta relativa del archivo a escribir.
   * @param writeRows - Callback que recibe la función append para escribir filas.
   * @returns La ruta absoluta del archivo escrito.
   */
  async writeNdjsonStream(
    relativePath: string,
    writeRows: (append: (row: unknown) => Promise<void>) => Promise<void>,
  ): Promise<string> {
    const filePath = this.resolvePath(relativePath);
    await mkdir(path.dirname(filePath), { recursive: true });

    const stream = createWriteStream(filePath, { encoding: "utf8" });

    try {
      await writeRows(async (row) => {
        if (!stream.write(stringifyNdjson(row))) {
          await once(stream, "drain");
        }
      });
    } finally {
      stream.end();
      await once(stream, "finish");
    }

    return filePath;
  }

  /**
   * Escribe datos binarios como archivo dentro del directorio del backup.
   *
   * @param relativePath - Ruta relativa del archivo a escribir.
   * @param data - Buffer con los datos binarios a guardar.
   * @returns La ruta absoluta del archivo escrito.
   */
  async writeBinary(relativePath: string, data: ArrayBuffer): Promise<string> {
    const filePath = this.resolvePath(relativePath);
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, Buffer.from(data));
    return filePath;
  }
}
