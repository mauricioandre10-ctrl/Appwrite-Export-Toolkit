import "dotenv/config";

import { mkdirSync, accessSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { z } from "zod";
import pino from "pino";

const envSchema = z.object({
  APPWRITE_ENDPOINT: z.string().url(),
  APPWRITE_PROJECT_ID: z.string().min(1),
  APPWRITE_API_KEY: z.string().min(1),
  APPWRITE_TARGET_ENDPOINT: z.string().url().optional().or(z.literal("")),
  APPWRITE_TARGET_PROJECT_ID: z.string().optional(),
  APPWRITE_TARGET_API_KEY: z.string().optional(),
  BACKUP_OUTPUT_DIR: z.string().min(1).default("/data/backups"),
  BACKUP_FORMAT_VERSION: z.string().min(1).default("1.0.0"),
});

/** Tipo inferido a partir del esquema Zod que define todas las variables de entorno necesarias. */
export type AppwriteConfig = z.infer<typeof envSchema>;

const configLogger = pino({
  level: process.env.LOG_LEVEL ?? "info",
  redact: {
    paths: ["APPWRITE_API_KEY", "APPWRITE_TARGET_API_KEY"],
    remove: true,
  },
});

function resolveBackupDir(configuredDir: string): string {
  const candidates = [
    configuredDir,
    "/data",
    path.resolve(process.cwd(), ".data"),
  ].map((dir) => path.resolve(dir));

  for (const candidate of candidates) {
    try {
      mkdirSync(candidate, { recursive: true });
      accessSync(candidate);
      configLogger.info({ backupDir: candidate }, "Backup directory resolved");
      return candidate;
    } catch {
      // try next candidate
    }
  }

  // Last resort: tmpdir. The dir may not be writable, but the
  // BackupWriter will throw a clearer error from there.
  const lastResort = path.join(os.tmpdir(), "appwrite-export-toolkit-backups");
  mkdirSync(lastResort, { recursive: true });
  configLogger.warn({ backupDir: lastResort }, "Backup directory fell back to tmpdir (last resort)");
  return lastResort;
}

/** Carga y valida las variables de entorno del proyecto origen. */
export function loadAppwriteConfig(): AppwriteConfig {
  const result = envSchema.safeParse(process.env);

  if (!result.success) {
    const issues = result.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ");
    throw new Error(`Invalid Appwrite environment config: ${issues}`);
  }

  const config = result.data;
  const backupDir = resolveBackupDir(config.BACKUP_OUTPUT_DIR);

  return { ...config, BACKUP_OUTPUT_DIR: backupDir };
}

/** Carga y valida la configuración del proyecto destino para operaciones de importación. */
export function loadTargetConfig(): AppwriteConfig {
  const result = envSchema.safeParse(process.env);

  if (!result.success) {
    const issues = result.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ");
    throw new Error(`Invalid Appwrite environment config: ${issues}`);
  }

  const config = result.data;
  const backupDir = resolveBackupDir(config.BACKUP_OUTPUT_DIR);

  if (!config.APPWRITE_TARGET_ENDPOINT || !config.APPWRITE_TARGET_PROJECT_ID || !config.APPWRITE_TARGET_API_KEY) {
    throw new Error(
      "Variables APPWRITE_TARGET_ENDPOINT, APPWRITE_TARGET_PROJECT_ID y APPWRITE_TARGET_API_KEY son obligatorias para importar. " +
      "No se permite importar al proyecto origen por seguridad."
    );
  }

  return {
    ...config,
    APPWRITE_ENDPOINT: config.APPWRITE_TARGET_ENDPOINT,
    APPWRITE_PROJECT_ID: config.APPWRITE_TARGET_PROJECT_ID,
    APPWRITE_API_KEY: config.APPWRITE_TARGET_API_KEY,
    BACKUP_OUTPUT_DIR: backupDir,
  };
}
