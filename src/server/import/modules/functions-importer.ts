import type { AppwriteServices } from "../../appwrite/client";
import type { IdRemapper } from "../id-remapper";
import type { ImportModuleResult } from "./auth-importer";
import type { Runtime } from "node-appwrite";

/**
 * Importa funciones desde un backup en el proyecto destino.
 *
 * Lee el directorio `functions/` y para cada subdirectorio `function_<id>`
 * carga su `meta.json` para recrear la función con su nombre, runtime,
 * permisos de ejecución, eventos, schedule y timeout.
 *
 * Después de crear la función, intenta restaurar las variables de entorno
 * desde `variables.json`. Si una variable ya existe, se ignora silenciosamente.
 *
 * **Comportamiento clave:**
 * - Si la función ya existe en el destino, se omite (skip-on-duplicate).
 * - Si no existe el directorio `functions/` o un `meta.json`, se omite silenciosamente.
 * - Los IDs se traducen mediante el `IdRemapper`.
 *
 * @param services - Cliente de Appwrite con servicios de functions.
 * @param backupRoot - Ruta raíz del backup en disco.
 * @param remapper - Instancia de IdRemapper para traducir IDs entre proyectos.
 * @returns Resultado del módulo con conteo de creadas, omitidas y errores.
 *   Estado `"failed"` si falla la lectura del directorio raíz;
 *   `"partial"` si algunas funciones fallaron.
 */
export async function importFunctions(
  services: AppwriteServices,
  backupRoot: string,
  remapper: IdRemapper,
): Promise<ImportModuleResult> {
  const result: ImportModuleResult = { module: "functions", status: "complete", created: 0, skipped: 0, errors: [] };

  try {
    const { readFile, readdir } = await import("node:fs/promises");
    const path = await import("node:path");

    const functionsDir = path.join(backupRoot, "functions");
    let entries: string[];
    try {
      entries = await readdir(functionsDir);
    } catch {
      return result;
    }

    const fnDirs = entries.filter((e) => e.startsWith("function_"));

    for (const fnDir of fnDirs) {
      const fnId = fnDir.replace("function_", "");
      const destFnId = remapper.getDestination("function", fnId) ?? fnId;

      const fnJsonPath = path.join(functionsDir, fnDir, "meta.json");
      try {
        const fnContent = await readFile(fnJsonPath, "utf8");
        const fnData = JSON.parse(fnContent) as Record<string, unknown>;

        try {
          await services.functions.get({ functionId: destFnId });
        } catch {
          try {
            const created = await services.functions.create({
              functionId: destFnId,
              name: String(fnData.name ?? fnId),
              runtime: String(fnData.runtime ?? "node-18.0") as Runtime,
              execute: (fnData.execute as string[]) ?? [],
              events: (fnData.events as string[]) ?? [],
              schedule: String(fnData.schedule ?? ""),
              timeout: Number(fnData.timeout ?? 15),
            });
            remapper.addMapping("function", fnId, String(created.$id));
            result.created += 1;
          } catch (error) {
            const msg = error instanceof Error ? error.message : "Unknown error";
            if (msg.includes("already exists")) {
              result.skipped += 1;
            } else {
              result.errors.push(`Function ${fnId}: ${msg}`);
              result.status = "partial";
              continue;
            }
          }
        }

        const varsPath = path.join(functionsDir, fnDir, "variables.json");
        try {
          const varsContent = await readFile(varsPath, "utf8");
          const vars = JSON.parse(varsContent) as Array<{ key: string; value: string }>;
          for (const v of vars) {
            try {
              await services.functions.createVariable({
                functionId: destFnId,
                key: v.key,
                value: v.value,
              });
            } catch {
              // Variable may already exist
            }
          }
        } catch {
          // No env.json
        }
      } catch {
        // No function.json
      }
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Unknown error";
    result.errors.push(`Functions import failed: ${msg}`);
    result.status = "failed";
  }

  return result;
}
