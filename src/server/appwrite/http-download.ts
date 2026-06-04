import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as NodeReadableStream } from "node:stream/web";

import type { AppwriteConfig } from "./config";
import { withRetry } from "../utils/retry";

/** Resultado de una descarga de archivo desde Appwrite. */
export type DownloadResult = {
  /** Ruta local donde se guardó el archivo descargado. */
  filePath: string;
  /** Hash SHA-256 del contenido descargado, en hexadecimal. */
  sha256: string;
  /** Cantidad total de bytes descargados. */
  bytes: number;
};

/**
 * Descarga un archivo de Storage de Appwrite y lo guarda en disco con verificación SHA-256.
 *
 * Construye la URL de descarga siguiendo el patrón:
 * `{endpoint}/storage/buckets/{bucketId}/files/{fileId}/download`
 *
 * Los IDs se codifican con `encodeURIComponent` para manejar caracteres especiales.
 *
 * @param input - Objeto con la configuración y parámetros de la descarga.
 * @param input.config - Configuración de Appwrite (endpoint, project ID, API key).
 * @param input.bucketId - ID del bucket de Storage de donde descargar.
 * @param input.fileId - ID del archivo a descargar dentro del bucket.
 * @param input.outputPath - Ruta local donde se guardará el archivo descargado.
 * @returns Objeto `DownloadResult` con la ruta del archivo, el hash SHA-256 y los bytes totales.
 * @throws {Error} Si la respuesta HTTP no es exitosa (status != 2xx).
 * @throws {Error} Si el body de la respuesta es null (respuesta sin contenido).
 */
export async function downloadStorageFile(input: {
  config: AppwriteConfig;
  bucketId: string;
  fileId: string;
  outputPath: string;
}): Promise<DownloadResult> {
  const url = `${input.config.APPWRITE_ENDPOINT}/storage/buckets/${encodeURIComponent(input.bucketId)}/files/${encodeURIComponent(input.fileId)}/download`;
  return downloadAppwriteResource({ config: input.config, url, outputPath: input.outputPath });
}

/**
 * Descarga el código fuente o los outputs de un deployment de una función de Appwrite.
 *
 * Construye la URL de descarga siguiendo el patrón:
 * `{endpoint}/functions/{functionId}/deployments/{deploymentId}/download?type={type}`
 *
 * @param input - Objeto con la configuración y parámetros de la descarga.
 * @param input.config - Configuración de Appwrite (endpoint, project ID, API key).
 * @param input.functionId - ID de la función de Appwrite.
 * @param input.deploymentId - ID del deployment específico a descargar.
 * @param input.outputPath - Ruta local donde se guardará el archivo descargado.
 * @param input.type - Tipo de descarga: `"source"` para el código fuente,
 *   `"output"` para los artefactos compilados/build result.
 * @returns Objeto `DownloadResult` con la ruta del archivo, el hash SHA-256 y los bytes totales.
 * @throws {Error} Si la respuesta HTTP no es exitosa (status != 2xx).
 * @throws {Error} Si el body de la respuesta es null (respuesta sin contenido).
 */
export async function downloadFunctionDeployment(input: {
  config: AppwriteConfig;
  functionId: string;
  deploymentId: string;
  outputPath: string;
  type: "source" | "output";
}): Promise<DownloadResult> {
  const url = `${input.config.APPWRITE_ENDPOINT}/functions/${encodeURIComponent(input.functionId)}/deployments/${encodeURIComponent(input.deploymentId)}/download?type=${input.type}`;
  return downloadAppwriteResource({ config: input.config, url, outputPath: input.outputPath });
}

/**
 * Descarga un recurso desde Appwrite con streaming, hash SHA-256 y reintento.
 *
 * Crea el directorio padre del `outputPath` si no existe (`recursive: true`).
 * Usa `pipeline` de Node.js para un streaming eficiente: el response body se
 * lee como un `ReadableStream`, se transforma para calcular el hash en vivo,
 * y se escribe directamente al disco sin acumular todo en memoria.
 *
 * Incluye reintento automático via `withRetry` (maneja errores transitorios
 * como timeouts o errores 5xx).
 *
 * @param input - Objeto con la configuración de la descarga.
 * @param input.config - Configuración de Appwrite (endpoint, project ID, API key).
 * @param input.url - URL completa del recurso a descargar.
 * @param input.outputPath - Ruta local donde se guardará el archivo.
 * @returns Objeto `DownloadResult` con la ruta del archivo, el hash SHA-256
 *   y la cantidad total de bytes descargados.
 * @throws {Error} Si la respuesta HTTP no es exitosa (status != 2xx).
 * @throws {Error} Si el body de la respuesta es null.
 */
async function downloadAppwriteResource(input: {
  config: AppwriteConfig;
  url: string;
  outputPath: string;
}): Promise<DownloadResult> {
  await mkdir(path.dirname(input.outputPath), { recursive: true });

  return withRetry(async () => {
    const response = await fetch(input.url, {
      headers: {
        "X-Appwrite-Project": input.config.APPWRITE_PROJECT_ID,
        "X-Appwrite-Key": input.config.APPWRITE_API_KEY,
      },
    });

    if (!response.ok || response.body === null) {
      throw Object.assign(new Error(`Download failed with HTTP ${response.status}: ${await response.text()}`), {
        code: response.status,
      });
    }

    const hash = createHash("sha256");
    let bytes = 0;
    const hashStream = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        hash.update(chunk);
        bytes += chunk.length;
        callback(null, chunk);
      },
    });

    await pipeline(
      Readable.fromWeb(response.body as unknown as NodeReadableStream<Uint8Array>),
      hashStream,
      createWriteStream(input.outputPath),
    );

    return {
      filePath: input.outputPath,
      sha256: hash.digest("hex"),
      bytes,
    };
  });
}
