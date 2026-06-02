import "dotenv/config";

import { mkdirSync, accessSync } from "node:fs";
import path from "node:path";
import { z } from "zod";

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

export type AppwriteConfig = z.infer<typeof envSchema>;

function resolveBackupDir(configuredDir: string): string {
  const resolved = path.resolve(configuredDir);

  try {
    mkdirSync(resolved, { recursive: true });
    accessSync(resolved);
    return resolved;
  } catch {
    // Configured dir not writable (e.g. /data on localhost)
  }

  const fallback = path.resolve("./backups");
  try {
    mkdirSync(fallback, { recursive: true });
    accessSync(fallback);
    return fallback;
  } catch {
    // Last resort
  }

  return resolved;
}

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
