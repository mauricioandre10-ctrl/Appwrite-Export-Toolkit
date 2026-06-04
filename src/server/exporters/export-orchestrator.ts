import path from "node:path";

import type { AppwriteConfig } from "../appwrite/config";
import type { AppwriteServices } from "../appwrite/client";
import { ExportJobLogger } from "../backup/export-job-logger";
import { BackupWriter } from "../backup/backup-writer";
import { collectFileChecksums } from "../backup/checksum-service";
import { createBackupId, resolveBackupRoot } from "../backup/paths";
import type { ExportModule } from "../backup/paths";
import { createInitialManifest } from "../manifest/manifest-service";
import type { BackupCounts, BackupModule } from "../types/backup";
import { updateJob } from "../import/progress-store";
import { exportAuth } from "./auth-exporter";
import { exportDatabases } from "./database-exporter";
import { exportStorage } from "./storage-exporter";
import type { ModuleExportResult } from "./types";

export const exportableModules = ["auth", "databases", "storage"] as const;

export type ExportableModule = (typeof exportableModules)[number];

export type ExportSelection = ExportableModule | "all";

export type BackupExportSummary = {
  backupId: string;
  backupRoot: string;
  modules: BackupModule[];
  counts: BackupCounts;
  warnings: string[];
  manifestPath: string;
};

const EXPORT_WEIGHTS: Record<string, number> = {
  auth: 20,
  databases: 60,
  storage: 20,
};

function computeExportPercent(modules: ExportableModule[], completedIndex: number): number {
  if (modules.length === 0) return 0;
  let weightSum = 0;
  let completedWeight = 0;
  for (let i = 0; i < modules.length; i++) {
    const w = EXPORT_WEIGHTS[modules[i]!] ?? 10;
    weightSum += w;
    if (i < completedIndex) {
      completedWeight += w;
    }
  }
  return Math.round((completedWeight / weightSum) * 100);
}

export async function exportBackup(input: {
  selection: ExportSelection;
  config: AppwriteConfig;
  services: AppwriteServices;
  jobId?: string;
  onProgress?: (percent: number, phase: string, module: string) => void;
}): Promise<BackupExportSummary> {
  const backupId = createBackupId(input.config.APPWRITE_PROJECT_ID, new Date(), input.selection as ExportModule);
  const backupRoot = resolveBackupRoot(input.config.BACKUP_OUTPUT_DIR, backupId);
  const writer = new BackupWriter(backupRoot);
  const jobLogger = new ExportJobLogger(backupRoot);
  await writer.ensureDir();
  await jobLogger.info("Export started", { backupId, selection: input.selection });

  if (input.jobId !== undefined) {
    await updateJob(input.jobId, { status: "running", phase: "initializing", module: "", percent: 0 });
  }
  input.onProgress?.(0, "initializing", "");

  const modules = resolveModules(input.selection);
  const results: ModuleExportResult[] = [];
  const manifest = createInitialManifest({
    formatVersion: input.config.BACKUP_FORMAT_VERSION,
    endpoint: input.config.APPWRITE_ENDPOINT,
    projectId: input.config.APPWRITE_PROJECT_ID,
    appwriteVersion: "1.8.x",
  });

  await writer.writeJson("project.json", {
    exportedAt: manifest.exportedAt,
    endpoint: input.config.APPWRITE_ENDPOINT,
    projectId: input.config.APPWRITE_PROJECT_ID,
    appwriteVersion: manifest.appwriteVersion,
    backupId,
  });

  for (let i = 0; i < modules.length; i++) {
    const moduleName = modules[i]!;
    await jobLogger.info("Module export started", { module: moduleName });

    if (input.jobId !== undefined) {
      const percent = computeExportPercent(modules, i);
      await updateJob(input.jobId, { status: "running", phase: "exporting", module: moduleName, percent });
    }
    input.onProgress?.(computeExportPercent(modules, i), "exporting", moduleName);

    try {
      const result = await runModuleExport(moduleName, input.config, input.services, writer);
      results.push(result);
      await jobLogger.info("Module export finished", {
        module: moduleName,
        status: result.status,
        counts: result.counts,
        warnings: result.warnings.length,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown module export error";
      results.push({
        module: moduleName,
        status: "failed",
        counts: {},
        warnings: [`Module ${moduleName} failed: ${message}`],
        files: [],
      });
      await jobLogger.error("Module export failed", { module: moduleName, error: message });
    }
  }

  manifest.modules = ["project", ...modules];
  manifest.counts = mergeCounts(results.map((result) => result.counts));
  manifest.warnings = results.flatMap((result) => result.warnings);
  manifest.moduleStatus = Object.fromEntries(results.map((result) => [result.module, result.status]));
  await jobLogger.info("Export finalizing", { backupId, moduleStatus: manifest.moduleStatus });

  if (input.jobId !== undefined) {
    await updateJob(input.jobId, { status: "running", phase: "checksums", module: "", percent: 95 });
  }
  input.onProgress?.(95, "checksums", "");

  manifest.checksums = await collectFileChecksums(backupRoot);

  const manifestPath = await writer.writeJson("manifest.json", manifest);

  const summary: BackupExportSummary = {
    backupId,
    backupRoot,
    modules: manifest.modules,
    counts: manifest.counts,
    warnings: manifest.warnings,
    manifestPath: path.relative(process.cwd(), manifestPath),
  };

  return summary;
}

export function parseExportSelection(value: string | undefined): ExportSelection {
  if (value === undefined || value === "all") {
    return "all";
  }

  if (isExportableModule(value)) {
    return value;
  }

  throw new Error(`Invalid export module "${value}". Use one of: all, ${exportableModules.join(", ")}`);
}

function resolveModules(selection: ExportSelection): ExportableModule[] {
  return selection === "all" ? [...exportableModules] : [selection];
}

function isExportableModule(value: string): value is ExportableModule {
  return exportableModules.includes(value as ExportableModule);
}

async function runModuleExport(
  moduleName: ExportableModule,
  config: AppwriteConfig,
  services: AppwriteServices,
  writer: BackupWriter,
): Promise<ModuleExportResult> {
  switch (moduleName) {
    case "auth":
      return exportAuth(services, writer);
    case "databases":
      return exportDatabases(services, writer);
    case "storage":
      return exportStorage(config, services, writer);
  }
}

function mergeCounts(counts: BackupCounts[]): BackupCounts {
  const merged: BackupCounts = {};

  for (const item of counts) {
    for (const [key, value] of Object.entries(item)) {
      if (typeof value !== "number") {
        continue;
      }

      const typedKey = key as keyof BackupCounts;
      merged[typedKey] = (merged[typedKey] ?? 0) + value;
    }
  }

  return merged;
}
