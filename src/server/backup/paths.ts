import path from "node:path";

/** Módulos disponibles para exportar en un backup. */
export type ExportModule = "all" | "auth" | "databases" | "storage";

const SAFE_BACKUP_ID_REGEX = /^[A-Za-z0-9._-]+$/;

/** Genera un ID de backup único con formato `{timestamp}_{module}_{projectId}`. */
export function createBackupId(projectId: string, date = new Date(), module: ExportModule = "all"): string {
  const timestamp = date.toISOString().replaceAll(":", "-").replace(/\.\d{3}Z$/, "Z");
  return `${timestamp}_${module}_${projectId}`;
}

/** Verifica que un string contenga solo caracteres seguros para usar como ID de backup. */
export function isSafeBackupId(value: string): boolean {
  return SAFE_BACKUP_ID_REGEX.test(value);
}

/** Resuelve la ruta absoluta del directorio raíz de un backup, validando seguridad del ID y previniendo path traversal. */
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
