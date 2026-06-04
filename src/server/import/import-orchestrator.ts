import pino from "pino";
import type { AppwriteServices } from "../appwrite/client";
import type { AppwriteConfig } from "../appwrite/config";
import { resolveManagedBackupPath } from "../backups/catalog";
import { IdRemapper } from "./id-remapper";
import { importAuth } from "./modules/auth-importer";
import { importDatabases } from "./modules/database-importer";
import { importStorage } from "./modules/storage-importer";
import type { ImportModuleResult } from "./modules/auth-importer";
import { updateJob } from "./progress-store";

const log = pino({ level: "info" });

/**
 * Tipo que define la selección de módulos para importar.
 * Contiene la lista de módulos que se van a restaurar desde el backup.
 */
export type ImportSelection = {
  /** Lista de nombres de módulos a importar */
  modules: string[];
};

/**
 * Tipo que representa el resultado completo de una importación de backup.
 * Contiene información sobre los módulos importados y el estado general de la operación.
 */
export type ImportResult = {
  /** ID del backup que se está importando */
  backupId: string;
  /** Endpoint de Appwrite destino de la importación */
  targetEndpoint: string;
  /** Resultados individuales de cada módulo importado */
  modules: ImportModuleResult[];
  /** Estado general de la importación */
  status: "complete" | "partial" | "failed";
  /** Fecha y hora de inicio de la importación */
  startedAt: string;
  /** Fecha y hora de finalización de la importación */
  finishedAt: string;
};

const RESTORE_ORDER = ["auth", "databases", "storage"];

const MODULE_WEIGHTS: Record<string, number> = {
  auth: 20,
  databases: 60,
  storage: 20,
};

/**
 * Parsea y valida una selección de importación desde un string.
 * Convierte el valor a un ImportSelection válido, filtrando módulos no soportados.
 *
 * @param input - String con la selección de módulos (puede ser "all" o lista separada por comas)
 * @returns La selección validada de importación con los módulos a restaurar
 */
export function parseImportSelection(input: string): ImportSelection {
  if (input === "all") {
    return { modules: [...RESTORE_ORDER] };
  }

  const modules = input
    .split(",")
    .map((m) => m.trim().toLowerCase())
    .filter((m) => RESTORE_ORDER.includes(m));

  return { modules: modules.length > 0 ? modules : [...RESTORE_ORDER] };
}

function computePercent(modules: string[], completedIndex: number): number {
  if (modules.length === 0) return 0;
  let weightSum = 0;
  let completedWeight = 0;
  for (let i = 0; i < modules.length; i++) {
    const w = MODULE_WEIGHTS[modules[i]!] ?? 10;
    weightSum += w;
    if (i < completedIndex) {
      completedWeight += w;
    }
  }
  return Math.round((completedWeight / weightSum) * 100);
}

/**
 * Orquesta el proceso completo de importación de backup hacia Appwrite.
 * Restaura los módulos seleccionados desde un backup existente, manejando el remapeo de IDs.
 *
 * @param input - Objeto con los parámetros de configuración para la importación
 * @param input.selection - Selección de módulos a importar
 * @param input.config - Configuración de conexión con Appwrite destino
 * @param input.services - Servicios configurados de Appwrite para realizar las llamadas API
 * @param input.backupPath - Ruta del backup a importar
 * @param input.jobId - ID opcional del job para seguimiento de progreso
 * @param input.onProgress - Callback opcional para reportar progreso de la importación
 * @returns Resultado completo de la importación realizada con estadísticas por módulo
 */
export async function importBackup(input: {
  selection: ImportSelection;
  config: AppwriteConfig;
  services: AppwriteServices;
  backupPath: string;
  jobId?: string;
  onProgress?: (percent: number, phase: string, module: string) => void;
}): Promise<ImportResult> {
  const { selection, config, services, backupPath, jobId } = input;
  const backupRoot = resolveManagedBackupPath(config.BACKUP_OUTPUT_DIR, backupPath);
  const remapper = await IdRemapper.load(backupRoot);

  log.info({ backupPath, modules: selection.modules, targetEndpoint: config.APPWRITE_ENDPOINT }, "Starting import");

  if (jobId !== undefined) {
    await updateJob(jobId, { status: "running", phase: "loading metadata", module: "", percent: 0 });
  }
  input.onProgress?.(0, "loading metadata", "");

  const result: ImportResult = {
    backupId: backupPath,
    targetEndpoint: config.APPWRITE_ENDPOINT,
    modules: [],
    status: "complete",
    startedAt: new Date().toISOString(),
    finishedAt: "",
  };

  for (let i = 0; i < selection.modules.length; i++) {
    const moduleName = selection.modules[i]!;
    let moduleResult: ImportModuleResult;

    const percent = computePercent(selection.modules, i);
    if (jobId !== undefined) {
      await updateJob(jobId, { status: "running", phase: "importing", module: moduleName, percent });
    }
    input.onProgress?.(percent, "importing", moduleName);

    log.info({ moduleName }, "Importing module");

    try {
      switch (moduleName) {
        case "auth":
          moduleResult = await importAuth(services, backupRoot, remapper);
          break;
        case "databases":
          moduleResult = await importDatabases(services, backupRoot, remapper, log);
          break;
        case "storage":
          moduleResult = await importStorage(services, backupRoot, remapper);
          break;
        default:
          moduleResult = {
            module: moduleName,
            status: "failed",
            created: 0,
            skipped: 0,
            errors: [`Unknown module: ${moduleName}`],
          };
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : "Unknown error";
      moduleResult = {
        module: moduleName,
        status: "failed",
        created: 0,
        skipped: 0,
        errors: [`Module ${moduleName} failed: ${msg}`],
      };
    }

    result.modules.push(moduleResult);

    log.info({ moduleName, status: moduleResult.status, created: moduleResult.created, skipped: moduleResult.skipped, errors: moduleResult.errors.length }, "Module import complete");

    if (moduleResult.status === "failed") {
      result.status = "failed";
    } else if (moduleResult.status === "partial" && result.status !== "failed") {
      result.status = "partial";
    }
  }

  result.finishedAt = new Date().toISOString();

  try {
    await remapper.save(backupRoot);
  } catch {
    // Best effort - remapper save failure doesn't affect import result
  }

  log.info({ status: result.status, totalCreated: result.modules.reduce((a, m) => a + m.created, 0) }, "Import finished");

  return result;
}
