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

/**
 * Lista de módulos que se pueden exportar desde Appwrite.
 * Incluye autenticación, bases de datos y almacenamiento.
 */
export const exportableModules = ["auth", "databases", "storage"] as const;

/**
 * Tipo que representa un módulo individual que se puede exportar.
 * Puede ser "auth", "databases" o "storage".
 */
export type ExportableModule = (typeof exportableModules)[number];

/**
 * Tipo que define la selección de módulos para exportar.
 * Puede ser un módulo específico o "all" para exportar todos.
 */
export type ExportSelection = ExportableModule | "all";

/**
 * Tipo que representa el resumen de una exportación de backup.
 * Contiene información sobre el backup creado, módulos exportados y estadísticas.
 */
export type BackupExportSummary = {
  /** ID único del backup */
  backupId: string;
  /** Ruta raíz donde se almacena el backup */
  backupRoot: string;
  /** Lista de módulos que fueron exportados */
  modules: BackupModule[];
  /** Conteos de elementos exportados por módulo */
  counts: BackupCounts;
  /** Advertencias encontradas durante la exportación */
  warnings: string[];
  /** Ruta al archivo manifest del backup */
  manifestPath: string;
};

const EXPORT_WEIGHTS: Record<string, number> = {
  auth: 20,
  databases: 60,
  storage: 20,
};

// Pesos relativos de cada módulo para el cálculo de progreso.
// databases (60%) pesa más porque es la parte más lenta y costosa;
// auth y storage (20% cuno) son comparativamente rápidos.
function computeExportPercent(modules: ExportableModule[], completedIndex: number): number {
  if (modules.length === 0) return 0;
  let weightSum = 0;
  let completedWeight = 0;
  for (let i = 0; i < modules.length; i++) {
    // Si el módulo no está en el mapa, usamos 10 como valor por defecto.
    const w = EXPORT_WEIGHTS[modules[i]!] ?? 10;
    weightSum += w;
    // Solo sumamos el peso de módulos cuyo índice es menor al actual,
    // es decir, los que ya terminaron de procesarse.
    if (i < completedIndex) {
      completedWeight += w;
    }
  }
  return Math.round((completedWeight / weightSum) * 100);
}

/**
 * Orquesta el proceso completo de exportación de backup desde Appwrite.
 * Maneja la exportación de módulos seleccionados, genera el manifest y calcula checksums.
 *
 * @param input - Objeto con los parámetros de configuración para la exportación
 * @param input.selection - Selección de módulos a exportar (módulo específico o "all")
 * @param input.config - Configuración de conexión con Appwrite
 * @param input.services - Servicios configurados de Appwrite para realizar las llamadas API
 * @param input.jobId - ID opcional del job para seguimiento de progreso
 * @param input.onProgress - Callback opcional para reportar progreso de la exportación
 * @returns Resumen completo de la exportación realizada con estadísticas y rutas
 */
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

/**
 * Parsea y valida una selección de exportación desde un string.
 * Convierte el valor a un ExportSelection válido o lanza error si no es válido.
 *
 * @param value - String con la selección de módulos (puede ser "all", módulo específico o undefined)
 * @returns La selección validada de exportación
 * @throws Error si el valor no es un módulo válido
 */
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
