import type { AppwriteServices } from "../../appwrite/client";
import type { IdRemapper } from "../id-remapper";
import type { ImportModuleResult } from "./auth-importer";

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
      const providers = JSON.parse(content) as Array<{ provider: Record<string, unknown> }>;

      for (const { provider } of providers) {
        const sourceId = String(provider.$id ?? "");
        try {
          await services.messaging.getProvider({ providerId: sourceId });
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
              providerId: sourceId,
              name: providerName,
              serviceAccountJSON: serviceAccountObj as Record<string, unknown>,
            });
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
