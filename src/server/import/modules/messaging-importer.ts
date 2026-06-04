import type { AppwriteServices } from "../../appwrite/client";
import type { IdRemapper } from "../id-remapper";
import type { ImportModuleResult } from "./auth-importer";

/**
 * Importa proveedores de mensajería y tópicos desde un backup.
 *
 * **Proveedores** (`messaging/providers.json`):
 * Lee el JSON, y por cada proveedor verifica si ya existe en el destino.
 * Solo se recrean proveedores de tipo FCM/firebase; otros tipos se saltan.
 * El `serviceAccountJSON` se parsea de string a objeto antes de pasarlo a la API.
 *
 * **Tópicos** (`messaging/topics.ndjson`):
 * Lee cada línea del NDJSON, y por cada topic verifica si ya existe en el
 * destino antes de crearlo.
 *
 * **Comportamiento clave:**
 * - Archivos no encontrados (providers.json, topics.ndjson) se ignoran silenciosamente.
 * - Líneas NDJSON inválidas se saltan sin error.
 * - Los IDs se traducen mediante el `IdRemapper`.
 *
 * @param services - Cliente de Appwrite con servicios de messaging.
 * @param backupRoot - Ruta raíz del backup en disco.
 * @param remapper - Instancia de IdRemapper para traducir IDs entre proyectos.
 * @returns Resultado del módulo con conteo de creados, omitidos y errores.
 *   Estado `"failed"` si falla la lectura del directorio raíz;
 *   `"partial"` si algunos proveedores o tópicos fallaron.
 */
export async function importMessaging(
  services: AppwriteServices,
  backupRoot: string,
  remapper: IdRemapper,
): Promise<ImportModuleResult> {
  const result: ImportModuleResult = { module: "messaging", status: "complete", created: 0, skipped: 0, errors: [] };

  try {
    const { readFile } = await import("node:fs/promises");
    const path = await import("node:path");

    const providersPath = path.join(backupRoot, "messaging", "providers.json");
    try {
      const content = await readFile(providersPath, "utf8");
      const providers = JSON.parse(content) as Array<Record<string, unknown>>;

      for (const provider of providers) {
        const sourceId = String(provider.$id ?? "");
        const destId = remapper.getDestination("provider", sourceId) ?? sourceId;
        try {
          await services.messaging.getProvider({ providerId: destId });
          result.skipped += 1;
          continue;
        } catch {
          // Provider doesn't exist, create it
        }

        try {
          const providerType = String(provider.type ?? "");
          const providerName = String(provider.name ?? sourceId);

          if (providerType === "fcm" || providerType === "firebase") {
            const serviceAccountRaw = (provider as Record<string, unknown>).serviceAccountJSON ?? "{}";
            const serviceAccountObj = typeof serviceAccountRaw === "string" ? JSON.parse(serviceAccountRaw) : serviceAccountRaw;
            await services.messaging.createFCMProvider({
              providerId: destId,
              name: providerName,
              serviceAccountJSON: serviceAccountObj as Record<string, unknown>,
            });
            remapper.addMapping("provider", sourceId, destId);
            result.created += 1;
          } else {
            result.skipped += 1;
          }
        } catch (error) {
          const msg = error instanceof Error ? error.message : "Unknown error";
          if (msg.includes("already exists")) {
            result.skipped += 1;
          } else {
            result.errors.push(`Provider ${sourceId}: ${msg}`);
            result.status = "partial";
          }
        }
      }
    } catch {
      // No providers.json
    }

    const topicsPath = path.join(backupRoot, "messaging", "topics.ndjson");
    try {
      const content = await readFile(topicsPath, "utf8");
      const lines = content.split("\n").filter((l) => l.trim().length > 0);

      for (const line of lines) {
        try {
          const topic = JSON.parse(line) as Record<string, unknown>;
          const sourceId = String(topic.$id ?? "");
          const destId = remapper.getDestination("topic", sourceId) ?? sourceId;

          try {
            await services.messaging.getTopic({ topicId: destId });
            result.skipped += 1;
          } catch {
            try {
              await services.messaging.createTopic({
                topicId: destId,
                name: String(topic.name ?? sourceId),
              });
              remapper.addMapping("topic", sourceId, destId);
              result.created += 1;
            } catch (error) {
              const msg = error instanceof Error ? error.message : "Unknown error";
              result.errors.push(`Topic ${sourceId}: ${msg}`);
              result.status = "partial";
            }
          }
        } catch {
          // Skip invalid lines
        }
      }
    } catch {
      // No topics.ndjson
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Unknown error";
    result.errors.push(`Messaging import failed: ${msg}`);
    result.status = "failed";
  }

  return result;
}
