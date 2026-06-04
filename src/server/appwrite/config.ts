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

/**
 * Resuelve el directorio de backups probando una cadena de candidatos con fallback.
 *
 * Intenta crear y verificar acceso en este orden:
 * 1. `configuredDir` (directorio configurado por el usuario).
 * 2. `/data` (volumen típico en Docker/Kubernetes).
 * 3. `.data` relativo al `process.cwd()`.
 * 4. Como último recurso: `os.tmpdir()` + `/appwrite-export-toolkit-backups`.
 *
 * Cada candidato se intenta con `mkdirSync({ recursive: true })` + `accessSync`.
 * Si ambos exitosan, se retorna ese directorio. Si alguno falla, se pasa al siguiente.
 *
 * Nota: el directorio tmpdir puede no ser persistente ni tener permisos de escritura
 * ideales, pero se usa como último recurso para que el error sea más claro que
 * un crash silencioso.
 *
 * @param configuredDir - Directorio configurado vía `BACKUP_OUTPUT_DIR`.
 * @returns Ruta absoluta del directorio de backups resuelto.
 */
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

/**
 * Carga y valida las variables de entorno del proyecto origen (Appwrite de export).
 *
 * Usa Zod para validar todas las variables requeridas contra `process.env`.
 * Las API keys se redactan automáticamente en logs por el logger configurado.
 *
 * Resolución del directorio de backups (`BACKUP_OUTPUT_DIR`):
 * 1. El valor configurado en la variable de entorno (default: `/data/backups`).
 * 2. Si falla, intenta `/data`.
 * 3. Si falla, intenta `.data` relativo al directorio de trabajo.
 * 4. Como último recurso, usa `os.tmpdir()` + `/appwrite-export-toolkit-backups`.
 *
 * @returns Configuración validada con el directorio de backups resuelto.
 * @throws {Error} Si las variables de entorno requeridas son inválidas o están ausentes.
 *   El mensaje incluye los campos específicos que fallaron la validación.
 */
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

/**
 * Carga y valida la configuración del proyecto destino para operaciones de importación.
 *
 * Requiere que las variables `APPWRITE_TARGET_ENDPOINT`, `APPWRITE_TARGET_PROJECT_ID`
 * y `APPWRITE_TARGET_API_KEY` estén definidas. Si alguna falta, lanza un error.
 *
 * Realiza un self-import check: no permite importar al mismo proyecto origen
 * por seguridad (aunque esta función solo remapea campos, no valida la coincidencia
 * de IDs — esa validación se hace en el orquestador de import).
 *
 * Remapea los campos target sobre los campos origen para devolver un `AppwriteConfig`
 * unificado:
 * - `APPWRITE_TARGET_ENDPOINT` → `APPWRITE_ENDPOINT`
 * - `APPWRITE_TARGET_PROJECT_ID` → `APPWRITE_PROJECT_ID`
 * - `APPWRITE_TARGET_API_KEY` → `APPWRITE_API_KEY`
 *
 * @returns Configuración del destino lista para usar como `AppwriteConfig`.
 * @throws {Error} Si las variables de entorno requeridas son inválidas (validación Zod).
 * @throws {Error} Si falta alguna de las variables target obligatorias.
 */
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
