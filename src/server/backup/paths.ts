import path from "node:path";

export type ExportModule = "all" | "auth" | "databases" | "storage" | "functions" | "messaging";

export function createBackupId(projectId: string, date = new Date(), module: ExportModule = "all"): string {
  const timestamp = date.toISOString().replaceAll(":", "-").replace(/\.\d{3}Z$/, "Z");
  return `${timestamp}_${module}_${projectId}`;
}

export function resolveBackupRoot(outputDir: string, backupId: string): string {
  return path.resolve(outputDir, backupId);
}
