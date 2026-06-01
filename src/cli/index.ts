#!/usr/bin/env node
import { Command } from "commander";

import { createAppwriteServices } from "@/server/appwrite/client";
import { loadAppwriteConfig } from "@/server/appwrite/config";
import { exportBackup, parseExportSelection } from "@/server/exporters/export-orchestrator";
import { inspectProject } from "@/server/inspectors/project-inspector";
import { stringifyJson } from "@/server/utils/json";
import { logger } from "@/server/utils/logger";
import { validateBackup } from "@/server/validators/backup-validator";

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

program.parseAsync(process.argv).catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "Unknown CLI error";
  logger.error({ err: error }, message);
  process.exitCode = 1;
});
