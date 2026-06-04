import path from "node:path";

export type ExportModule = "all" | "auth" | "databases" | "storage";

const SAFE_BACKUP_ID_REGEX = /^[A-Za-z0-9._-]+$/;

export function createBackupId(projectId: string, date = new Date(), module: ExportModule = "all"): string {
  const timestamp = date.toISOString().replaceAll(":", "-").replace(/\.\d{3}Z$/, "Z");
  return `${timestamp}_${module}_${projectId}`;
}

export function isSafeBackupId(value: string): boolean {
  return SAFE_BACKUP_ID_REGEX.test(value);
}

export function resolveBackupRoot(outputDir: string, backupId: string): string {
  if (!isSafeBackupId(backupId)) {
    throw new Error(`Invalid backup ID: ${backupId}`);
  }
  const resolved = path.resolve(outputDir, backupId);
  if (!resolved.startsWith(path.resolve(outputDir))) {
    throw new Error(`Path traversal attempt blocked: ${backupId}`);
  }
  return resolved;
}
