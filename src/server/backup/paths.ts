import path from "node:path";

export function createBackupId(projectId: string, date = new Date()): string {
  const timestamp = date.toISOString().replaceAll(":", "-").replace(/\.\d{3}Z$/, "Z");
  return `${timestamp}_${projectId}`;
}

export function resolveBackupRoot(outputDir: string, backupId: string): string {
  return path.resolve(outputDir, backupId);
}
