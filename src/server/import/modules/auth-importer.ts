import { Query } from "node-appwrite";
import type { AppwriteServices } from "../../appwrite/client";
import type { IdRemapper } from "../id-remapper";
import { createHash } from "node:crypto";

/** Resultado del proceso de importación de un módulo, con conteo de elementos creados, omitidos y errores. */
export type ImportModuleResult = {
  module: string;
  status: "complete" | "partial" | "failed";
  created: number;
  skipped: number;
  errors: string[];
};

/**
 * Importa usuarios de autenticación desde un archivo `auth/users.ndjson`.
 *
 * Lee cada línea del archivo NDJSON, crea los usuarios en el proyecto destino
 * con contraseñas temporales deterministas, y restaura labels y prefs en
 * operaciones best-effort.
 *
 * Si el usuario ya existe (error "duplicate"), intenta resolver el mapeo
 * buscando por email en el proyecto destino. Si el mapeo previo del remapper
 * apunta a un usuario que ya no existe, lo descarta y recrea el usuario.
 *
 * Se omiten usuarios sin email ni nombre.
 *
 * @param services - Cliente de Appwrite con los servicios necesarios (users).
 * @param backupRoot - Ruta raíz del backup en disco.
 * @param remapper - Instancia de IdRemapper para traducir IDs de origen a destino.
 * @returns Resultado del módulo con conteo de creados, omitidos y errores.
 *   Estado `"failed"` si la lectura del archivo falla completamente;
 *   `"partial"` si algunos usuarios fallaron pero otros se procesaron.
 *   `"complete"` si todo se procesó sin errores.
 */
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
          // Verify the mapped user still exists in the target. The IdRemapper
          // persists across imports — if the target project was wiped and the
          // user was deleted, the old mapping is stale and we should re-create.
          try {
            await services.users.get(existingMapping);
            result.skipped += 1;
            continue;
          } catch {
            // User no longer exists; clear the stale mapping and create fresh.
            remapper.removeMapping("user", sourceId);
          }
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

/**
 * Genera una contraseña temporal determinista a partir de un seed.
 *
 * Usa SHA-256 sobre el seed y extrae los primeros 16 caracteres hexadecimales.
 * La contraseña resultante cumple complejidad básica: empieza con "Temp",
 * termina con "!1Aa" (mayúscula, minúscula, número).
 *
 * **Importante:** estas contraseñas son temporales y predecibles — solo deben
 * usarse para que el usuario pueda hacer reset en el sistema destino.
 *
 * @param seed - String semilla (típicamente el ID de usuario de origen).
 * @returns Contraseña temporal de 24 caracteres.
 */
function generateTempPassword(seed: string): string {
  return `Temp${createHash("sha256").update(seed).digest("hex").slice(0, 16)}!1Aa`;
}
