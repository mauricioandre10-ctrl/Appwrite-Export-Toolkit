import { Query } from "node-appwrite";
import type { AppwriteServices } from "../../appwrite/client";
import type { IdRemapper } from "../id-remapper";
import { createHash } from "node:crypto";

export type ImportModuleResult = {
  module: string;
  status: "complete" | "partial" | "failed";
  created: number;
  skipped: number;
  errors: string[];
};

export async function importAuth(
  services: AppwriteServices,
  backupRoot: string,
  remapper: IdRemapper,
): Promise<ImportModuleResult> {
  const result: ImportModuleResult = { module: "auth", status: "complete", created: 0, skipped: 0, errors: [] };

  try {
    const { readFile } = await import("node:fs/promises");
    const path = await import("node:path");

    const usersFile = path.join(backupRoot, "auth", "users.ndjson");
    let content: string;
    try {
      content = await readFile(usersFile, "utf8");
    } catch {
      return result;
    }

    const lines = content.split("\n").filter((l) => l.trim().length > 0);

    for (const line of lines) {
      try {
        const user = JSON.parse(line) as Record<string, unknown>;
        const sourceId = String(user.$id ?? "");

        if (!user.email && !user.name) {
          result.skipped += 1;
          continue;
        }

        const existingMapping = remapper.getDestination("user", sourceId);
        if (existingMapping) {
          result.skipped += 1;
          continue;
        }

        const email = String(user.email ?? "");
        const name = String(user.name ?? "");
        const password = generateTempPassword(sourceId);

        try {
          const params: { userId: string; email?: string; name?: string; password: string } = {
            userId: sourceId,
            password,
          };
          if (email) params.email = email;
          if (name) params.name = name;

          const created = await services.users.create(params);

          const userId = String(created.$id);

          const labels = user.labels;
          if (Array.isArray(labels) && labels.length > 0) {
            try {
              await services.users.updateLabels({ userId, labels });
            } catch {
              // Best effort
            }
          }

          const prefs = user.prefs;
          if (prefs !== null && prefs !== undefined && typeof prefs === "object" && Object.keys(prefs as Record<string, unknown>).length > 0) {
            try {
              await services.users.updatePrefs({ userId, prefs: prefs as Record<string, unknown> });
            } catch {
              // Best effort
            }
          }

          remapper.addMapping("user", sourceId, userId);
          result.created += 1;
        } catch (error) {
          const msg = error instanceof Error ? error.message : "Unknown error";
          if (msg.includes("already exists") || msg.includes("duplicate")) {
            if (email) {
              try {
                const existing = await services.users.list([Query.equal("email", [email])]);
                const foundUser = existing.users[0];
                if (foundUser) {
                  remapper.addMapping("user", sourceId, String(foundUser.$id));
                }
              } catch {
                // Could not find existing user
              }
            }
            result.skipped += 1;
          } else {
            result.errors.push(`User ${sourceId}: ${msg}`);
            result.status = "partial";
          }
        }
      } catch {
        result.errors.push("Failed to parse user line");
        result.status = "partial";
      }
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Unknown error";
    result.errors.push(`Auth import failed: ${msg}`);
    result.status = "failed";
  }

  return result;
}

function generateTempPassword(seed: string): string {
  return `Temp${createHash("sha256").update(seed).digest("hex").slice(0, 16)}!1Aa`;
}
