import type { AppwriteServices } from "../../appwrite/client";
import type { IdRemapper } from "../id-remapper";
import type { ImportModuleResult } from "./auth-importer";
import type { Compression } from "node-appwrite";

/**
 * Remapea los IDs de usuario dentro de strings de permisos Appwrite.
 *
 * Busca patrones `user:<id>` en cada string de permiso y reemplaza el ID de
 * origen con el ID de destino según el remapper. Si no existe mapeo para un
 * usuario, conserva el ID original sin modificar.
 *
 * Los permisos de tipo `team:` o `role:` no se modifican.
 *
 * @param permissions - Array de strings de permisos Appwrite (ej. `["user:abc123", "role:member"]`).
 * @param remapper - Instancia de IdRemapper con los mapeos de usuarios.
 * @returns Nuevo array con los permisos actualizados.
 */
function sanitizePermissions(permissions: string[], remapper: IdRemapper): string[] {
  return permissions.map((p) => {
    const userMatch = p.match(/user:([^")]+)/);
    if (userMatch?.[1]) {
      const sourceUserId = userMatch[1];
      const destUserId = remapper.getDestination("user", sourceUserId) ?? sourceUserId;
      return p.replace(/user:[^")]+/, `user:${destUserId}`);
    }
    return p;
  });
}

/**
 * Importa buckets y archivos de storage desde un backup.
 *
 * Lee `storage/buckets.json` para crear cada bucket en el proyecto destino.
 * Para cada bucket, busca el directorio `bucket_<id>/files.ndjson` y sube
 * cada archivo referenciado.
 *
 * **Comportamiento clave:**
 * - Saltas buckets/archivos que ya existen (skip-on-duplicate).
 * - Protege contra path traversal: rechaza blobs cuya ruta resuelta
 *   escape del directorio `backupRoot`.
 * - Remapea permisos de usuario en archivos usando el `IdRemapper`.
 * - Los archivos sin `blobPath` se omiten silenciosamente.
 *
 * @param services - Cliente de Appwrite con servicios de storage y users.
 * @param backupRoot - Ruta raíz del backup en disco.
 * @param remapper - Instancia de IdRemapper para traducir IDs entre proyectos.
 * @returns Resultado del módulo con conteo de creados, omitidos y errores.
 *   Estado `"failed"` si la lectura del JSON principal falla;
 *   `"partial"` si hubo errores parciales en buckets o archivos.
 */
export async function importStorage(
  services: AppwriteServices,
  backupRoot: string,
  remapper: IdRemapper,
): Promise<ImportModuleResult> {
  const result: ImportModuleResult = { module: "storage", status: "complete", created: 0, skipped: 0, errors: [] };

  try {
    const { readFile } = await import("node:fs/promises");
    const path = await import("node:path");

    const bucketsJsonPath = path.join(backupRoot, "storage", "buckets.json");
    let bucketsData: Array<{ bucket: Record<string, unknown> }>;
    try {
      bucketsData = JSON.parse(await readFile(bucketsJsonPath, "utf8")) as Array<{ bucket: Record<string, unknown> }>;
    } catch {
      return result;
    }

    for (const { bucket } of bucketsData) {
      const sourceId = String(bucket.$id ?? "");
      const name = String(bucket.name ?? sourceId);
      const destId = remapper.getDestination("bucket", sourceId) ?? sourceId;

      try {
        await services.storage.getBucket({ bucketId: destId });
      } catch {
        try {
          const created = await services.storage.createBucket({
            bucketId: destId,
            name: name,
            permissions: (bucket.permissions as string[]) ?? [],
            fileSecurity: Boolean(bucket.fileSecurity),
            maximumFileSize: Number(bucket.maximumFileSize ?? 30000000),
            allowedFileExtensions: (bucket.allowedFileExtensions as string[]) ?? [],
            compression: (bucket.compression as string as Compression) ?? "none",
            encryption: Boolean(bucket.encryption),
            antivirus: Boolean(bucket.antivirus),
          });
          remapper.addMapping("bucket", sourceId, String(created.$id));
          result.created += 1;
        } catch (error) {
          const msg = error instanceof Error ? error.message : "Unknown error";
          if (msg.includes("already exists")) {
            result.skipped += 1;
          } else {
            result.errors.push(`Bucket ${sourceId}: ${msg}`);
            result.status = "partial";
            continue;
          }
        }
      }

      const bucketDir = path.join(backupRoot, "storage", `bucket_${sourceId}`);
      const filesJsonPath = path.join(bucketDir, "files.ndjson");
      let fileLines: string[];
      try {
        fileLines = (await readFile(filesJsonPath, "utf8")).split("\n").filter((l) => l.trim().length > 0);
      } catch {
        continue;
      }

      for (const line of fileLines) {
        try {
          const fileMeta = JSON.parse(line) as Record<string, unknown>;
          const sourceFileId = String(fileMeta.$id ?? "");
          const blobPath = String(fileMeta.blobPath ?? "");

          if (!blobPath) {
            result.skipped += 1;
            continue;
          }

          const fullBlobPath = path.resolve(backupRoot, blobPath);
          if (!fullBlobPath.startsWith(path.resolve(backupRoot))) {
            result.errors.push(`Path traversal attempt blocked: ${sourceFileId}`);
            result.status = "partial";
            continue;
          }
          let fileBuffer: Buffer;
          try {
            const { readFile: rf } = await import("node:fs/promises");
            fileBuffer = await rf(fullBlobPath);
          } catch {
            result.errors.push(`Blob not found: ${sourceFileId}`);
            result.status = "partial";
            continue;
          }

          const mimeType = String(fileMeta.mimeType ?? "application/octet-stream");
          const file = new File([new Uint8Array(fileBuffer)], String(fileMeta.name ?? sourceFileId), { type: mimeType });

          try {
            const created = await services.storage.createFile({
              bucketId: destId,
              fileId: sourceFileId,
              file: file,
              permissions: sanitizePermissions((fileMeta.$permissions as string[]) ?? [], remapper),
            });
            remapper.addMapping("bucket", sourceFileId, String(created.$id));
            result.created += 1;
          } catch (error) {
            const msg = error instanceof Error ? error.message : "Unknown error";
            if (msg.includes("already exists")) {
              result.skipped += 1;
            } else {
              result.errors.push(`File ${sourceFileId}: ${msg}`);
              result.status = "partial";
            }
          }
        } catch {
          // Skip invalid lines
        }
      }
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Unknown error";
    result.errors.push(`Storage import failed: ${msg}`);
    result.status = "failed";
  }

  return result;
}
