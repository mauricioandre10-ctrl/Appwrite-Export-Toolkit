import pino from "pino";
import type { AppwriteServices } from "../appwrite/client";
import type { AppwriteConfig } from "../appwrite/config";
import { resolveManagedBackupPath } from "../backups/catalog";
import { IdRemapper } from "./id-remapper";
import { importAuth } from "./modules/auth-importer";
import { importDatabases } from "./modules/database-importer";
import { importStorage } from "./modules/storage-importer";
import type { ImportModuleResult } from "./modules/auth-importer";
import { updateJob, completeJob } from "./progress-store";

const log = pino({ level: "info" });

export type ImportSelection = {
  modules: string[];
};

export type ImportResult = {
  backupId: string;
  targetEndpoint: string;
  modules: ImportModuleResult[];
  status: "complete" | "partial" | "failed";
  startedAt: string;
  finishedAt: string;
};

const RESTORE_ORDER = ["auth", "databases", "storage"];

const MODULE_WEIGHTS: Record<string, number> = {
  auth: 20,
  databases: 60,
  storage: 20,
};

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

  if (jobId !== undefined) {
    await completeJob(jobId, result);
  }

  log.info({ status: result.status, totalCreated: result.modules.reduce((a, m) => a + m.created, 0) }, "Import finished");

  return result;
}
