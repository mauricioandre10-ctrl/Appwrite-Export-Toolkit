import type { AppwriteServices } from "../appwrite/client";
import type { BackupWriter } from "../backup/backup-writer";
import { listAll, paginateRows } from "../utils/pagination";
import { omitSensitiveFields } from "./sanitize";
import type { JsonObject, ModuleExportResult } from "./types";

/**
 * Exporta proveedores, topics, suscriptores y mensajes de Messaging, redactando credenciales.
 * Genera placeholders para credenciales de proveedores que requieren restauración manual.
 *
 * @param services - Cliente Appwrite con el SDK de messaging.
 * @param writer - BackupWriter encargado de crear directorios y escribir los archivos de backup.
 * @returns Resultado del export con contadores de providers, topics y mensajes, más warnings.
 * @throws Si falla la escritura de archivos o la conexión con Appwrite.
 *
 * @remarks
 * - Las credenciales de proveedores (API keys, tokens) no se exportan; se generan placeholders.
 * - Los mensajes históricos se exportan solo para auditoría, no son necesarios para restaurar funcionalidad.
 * - Los subscribers se asocian a su topic correspondiente en el archivo NDJSON.
 * - Los providers se redactan con `omitSensitiveFields` antes de escribir.
 * - Los mensajes se procesan en streaming para soportar volúmenes grandes.
 * - El archivo `credentials.placeholders.json` lista los proveedores que requieren reconfiguración manual.
 */
export async function exportMessaging(services: AppwriteServices, writer: BackupWriter): Promise<ModuleExportResult> {
  await writer.ensureDir("messaging");

  const [providers, topics] = await Promise.all([
    listAll("providers", (queries) => services.messaging.listProviders(queries)),
    listAll("topics", (queries) => services.messaging.listTopics(queries)),
  ]);

  const subscribers: unknown[] = [];
  let messageCount = 0;
  const warnings = [
    "Messaging provider credentials are not recoverable and are exported as placeholders.",
    "Historical messages are exported for audit only and are not required for functional restore.",
  ];

  for (const topic of topics.rows) {
    const topicId = String(topic.$id);
    const topicSubscribers = await listAll("subscribers", (queries) => services.messaging.listSubscribers(topicId, queries));
    subscribers.push(...topicSubscribers.rows.map((subscriber) => ({ topicId, ...toObject(subscriber) })));
  }

  const providerPlaceholders = providers.rows.map((provider) => ({
    providerId: String(provider.$id),
    name: provider.name,
    provider: provider.provider,
    type: provider.type,
    requiresManualCredentials: true,
  }));

  const files = [
    await writer.writeJson("messaging/providers.json", providers.rows.map((provider) => omitSensitiveFields(provider))),
    await writer.writeNdjson("messaging/topics.ndjson", topics.rows),
    await writer.writeNdjson("messaging/subscribers.ndjson", subscribers),
    await writer.writeNdjsonStream("messaging/messages.ndjson", async (append) => {
      for await (const page of paginateRows("messages", (queries) => services.messaging.listMessages(queries))) {
        messageCount += page.rows.length;
        for (const message of page.rows) {
          await append(omitSensitiveFields(message));
        }
      }
    }),
    await writer.writeJson("messaging/credentials.placeholders.json", { providers: providerPlaceholders }),
    await writer.writeJson("messaging/meta.json", {
      exportedAt: new Date().toISOString(),
      counts: {
        providers: providers.total,
        topics: topics.total,
        subscribers: subscribers.length,
        messages: messageCount,
      },
      warnings,
    }),
  ];

  return {
    module: "messaging",
    status: "complete",
    counts: {
      providers: providers.total,
      topics: topics.total,
      messages: messageCount,
    },
    warnings,
    files,
  };
}

function toObject(value: unknown): JsonObject {
  return typeof value === "object" && value !== null ? (value as JsonObject) : {};
}
