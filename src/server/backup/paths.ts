import path from "node:path";

/** Módulos disponibles para exportar en un backup. */
export type ExportModule = "all" | "auth" | "databases" | "storage";

const SAFE_BACKUP_ID_REGEX = /^[A-Za-z0-9._-]+$/;

/**
 * Genera un ID de backup único con formato `{timestamp}_{module}_{projectId}`.
 *
 * El timestamp se genera en formato ISO 8601 UTC, con los dos puntos (`:`) reemplazados
 * por guiones (`-`) para que sea seguro para nombres de archivo, y los milisegundos
 * eliminados. Por ejemplo: `2025-01-15T10-30-00Z_auth_myproject`.
 *
 * @param projectId - Identificador del proyecto de Appwrite. Se incluye tal cual en el ID.
 * @param date - Objeto `Date` a usar para generar el timestamp (default: `new Date()`).
 *   Se convierte a UTC con `toISOString()`.
 * @param module - Módulo de exportación. Valores válidos: `"all"`, `"auth"`, `"databases"`,
 *   `"storage"` (default: `"all"`).
 * @returns String con el ID de backup en formato `{ISO timestamp sanitizado}_{module}_{projectId}`.
 */
export function createBackupId(projectId: string, date = new Date(), module: ExportModule = "all"): string {
  const timestamp = date.toISOString().replaceAll(":", "-").replace(/\.\d{3}Z$/, "Z");
  return `${timestamp}_${module}_${projectId}`;
}

/**
 * Verifica que un string contenga solo caracteres seguros para usar como ID de backup.
 *
 * Los caracteres permitidos son: letras (a-z, A-Z), números (0-9), puntos (`.`),
 * guiones bajos (`_`) y guiones (`-`). Esto previene path traversal y otros
 * problemas de seguridad al usar el ID como parte de una ruta de sistema de archivos.
 *
 * @param value - String a validar como ID de backup.
 * @returns `true` si el string contiene exclusivamente caracteres seguros, `false` en caso contrario.
 *
 * @edge-cases
 * - String vacío retorna `false` (requiere al menos un carácter válido).
 * - No valida la longitud; acepta strings de cualquier tamaño.
 */
export function isSafeBackupId(value: string): boolean {
  return SAFE_BACKUP_ID_REGEX.test(value);
}

/**
 * Resuelve la ruta absoluta del directorio raíz de un backup, validando el ID y previniendo path traversal.
 *
 * El `backupId` debe contener solo caracteres seguros (letras, números, `.`, `_`, `-`).
 * Después de validar, se resuelve la ruta combinando `outputDir` y `backupId` con `path.resolve`,
 * y se verifica que la ruta resultante esté dentro de `outputDir` para bloquear intentos de
 * path traversal (por ejemplo, `../../etc/passwd`).
 *
 * @param outputDir - Directorio base donde se almacenan los backups. Debe ser una ruta absoluta
 *   o una ruta que pueda resolverse相对于 el cwd.
 * @param backupId - Identificador del backup a resolver. Validado contra el regex `/^[A-Za-z0-9._-]+$/`.
 * @returns La ruta absoluta del directorio del backup: `path.resolve(outputDir, backupId)`.
 * @throws {Error} Si el `backupId` contiene caracteres no seguros (no pasa la validación de regex).
 * @throws {Error} Si la ruta resuelta está fuera de `outputDir` (path traversal detectado).
 */
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
