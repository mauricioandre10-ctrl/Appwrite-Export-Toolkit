#!/usr/bin/env node
import { Command } from "commander";

import { createAppwriteServices } from "@/server/appwrite/client";
import { loadAppwriteConfig, loadTargetConfig } from "@/server/appwrite/config";
import { exportBackup, parseExportSelection } from "@/server/exporters/export-orchestrator";
import { importBackup, parseImportSelection } from "@/server/import/import-orchestrator";
import { inspectProject } from "@/server/inspectors/project-inspector";
import { stringifyJson } from "@/server/utils/json";
import { logger } from "@/server/utils/logger";
import { validateBackup } from "@/server/validators/backup-validator";
import { getBackupDeletionInfo, deleteBackup, formatBytes } from "@/server/backups/delete-catalog";

const program = new Command();

program
  .name("appwrite-export-toolkit")
  .description("Structured export, validation, and restore toolkit for Appwrite projects")
  .version("0.1.0");

program
  .command("inspect")
  .description("Inspect the configured Appwrite project and print a safe summary")
  .action(async () => {
    const config = loadAppwriteConfig();
    const services = createAppwriteServices(config);
    const inspection = await inspectProject(config, services);

    process.stdout.write(stringifyJson(inspection));
  });

program
  .command("export")
  .argument("[module]", "Module to export: all, auth, messaging, databases, storage, functions", "all")
  .description("Export the configured Appwrite project into BACKUP_OUTPUT_DIR")
  .action(async (moduleName: string | undefined) => {
    const config = loadAppwriteConfig();
    const services = createAppwriteServices(config);
    const selection = parseExportSelection(moduleName);
    const summary = await exportBackup({ selection, config, services });

    process.stdout.write(stringifyJson(summary));
  });

program
  .command("validate")
  .argument("<backupPath>", "Path to a backup directory containing manifest.json")
  .description("Validate backup structure, checksums, blobs and cross-resource references")
  .action(async (backupPath: string) => {
    const result = await validateBackup(backupPath);
    process.stdout.write(stringifyJson(result));

    if (!result.ok) {
      process.exitCode = 1;
    }
  });

program
  .command("import")
  .argument("[module]", "Module to import: all, auth, messaging, databases, storage, functions", "all")
  .option("--backup <path>", "Backup directory name inside BACKUP_OUTPUT_DIR")
  .description("Import a backup into the configured Appwrite target project")
  .action(async (moduleName: string | undefined, options: { backup?: string }) => {
    const config = loadTargetConfig();
    const services = createAppwriteServices(config);

    if (!options.backup) {
      logger.error("Missing --backup <path> argument");
      process.exitCode = 1;
      return;
    }

    const selection = parseImportSelection(moduleName ?? "all");
    const result = await importBackup({ selection, config, services, backupPath: options.backup });

    process.stdout.write(stringifyJson(result));

    if (result.status === "failed") {
      process.exitCode = 1;
    }
  });

program
  .command("delete")
  .argument("<backupId>", "Backup directory name inside BACKUP_OUTPUT_DIR")
  .option("--confirm", "Skip confirmation and delete immediately")
  .description("Delete a backup (two-step: first show info, then confirm)")
  .action(async (backupId: string, options: { confirm?: boolean }) => {
    const config = loadAppwriteConfig();

    try {
      const info = await getBackupDeletionInfo(config.BACKUP_OUTPUT_DIR, backupId);

      process.stdout.write("\n");
      process.stdout.write(`  Backup:       ${info.backupId}\n`);
      process.stdout.write(`  Exportado:    ${new Date(info.exportedAt).toLocaleString("es-ES")}\n`);
      process.stdout.write(`  Proyecto:     ${info.projectId}\n`);
      process.stdout.write(`  Modulos:      ${info.modules.join(", ")}\n`);
      process.stdout.write(`  Archivos:     ${info.fileCount}\n`);
      process.stdout.write(`  Tamano:       ${formatBytes(info.totalSizeBytes)}\n`);
      process.stdout.write("\n");

      if (!options.confirm) {
        process.stdout.write("  ⚠  Esta accion ELIMINARA permanentemente todos los archivos de este backup.\n");
        process.stdout.write("  Para confirmar, ejecuta de nuevo con --confirm:\n");
        process.stdout.write(`     npx tsx src/cli/index.ts delete ${backupId} --confirm\n\n`);
        return;
      }

      await deleteBackup(config.BACKUP_OUTPUT_DIR, backupId);
      process.stdout.write(`  ✓ Backup ${backupId} eliminado correctamente.\n`);
    } catch (error) {
      const msg = error instanceof Error ? error.message : "Error desconocido";
      logger.error({ err: error }, msg);
      process.exitCode = 1;
    }
  });

program.parseAsync(process.argv).catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "Unknown CLI error";
  logger.error({ err: error }, message);
  process.exitCode = 1;
});
