import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

import type { BackupCounts, BackupManifest } from "../types/backup";

/** Resumen completo de un backup exportado, incluyendo metadatos, estado de los módulos y logs recientes. */
export type BackupSummary = {
  backupId: string;
  backupRoot: string;
  exportedAt: string;
  projectId: string;
  modules: string[];
  counts: BackupCounts;
  warnings: number;
  warningMessages: string[];
  checksums: number;
  moduleStatus: Record<string, string>;
  progress: number;
  latestLogs: BackupLogEntry[];
};

/** Entrada individual de log de un backup, con timestamp, nivel y mensaje descriptivo. */
export type BackupLogEntry = {
  timestamp: string;
  level: "INFO" | "WARN" | "ERROR";
  message: string;
  data: Record<string, unknown>;
};

/**
 * Lista todos los backups disponibles en el directorio de salida,
 * leyendo sus manifiestos y devolviendo un resumen ordenado por fecha de exportación.
 *
 * @param outputDir - Directorio raíz donde se encuentran los backups.
 * @returns Arreglo de resúmenes de backups, ordenados del más reciente al más antiguo.
 */
export async function listBackupSummaries(outputDir: string): Promise<BackupSummary[]> {
  const root = path.resolve(/* turbopackIgnore: true */ outputDir);
  let entries: string[];

  try {
    entries = await readdir(root);
  } catch {
    return [];
  }

  const summaries: Array<BackupSummary | null> = await Promise.all(
    entries.map(async (backupId) => {
      if (!isSafeBackupId(backupId)) {
        return null;
      }

      const backupRoot = resolveManagedBackupPath(root, backupId);
      const manifest = await readManifest(path.join(/* turbopackIgnore: true */ backupRoot, "manifest.json"));

      if (manifest === null) {
        return null;
      }

       return {
         backupId,
         backupRoot,
         exportedAt: manifest.exportedAt,
         projectId: manifest.projectId,
         modules: [...manifest.modules],
         counts: manifest.counts,
         warnings: manifest.warnings.length,
         warningMessages: [...manifest.warnings],
         checksums: Object.keys(manifest.checksums).length,
         moduleStatus: manifest.moduleStatus ?? {},
         progress: calculateProgress(manifest.moduleStatus ?? {}),
         latestLogs: await readBackupLogs(backupRoot, 8),
       } satisfies BackupSummary;
    }),
  );

  return summaries
    .filter(isBackupSummary)
    .sort((a, b) => b.exportedAt.localeCompare(a.exportedAt));
}

/**
 * Lee las últimas entradas de log de un backup específico.
 *
 * @param backupRoot - Ruta absoluta del directorio del backup.
 * @param limit - Cantidad máxima de entradas a devolver (por defecto 50).
 * @returns Arreglo de entradas de log parseadas, ordenadas cronológicamente.
 */
export async function readBackupLogs(backupRoot: string, limit = 50): Promise<BackupLogEntry[]> {
  try {
    const content = await readFile(path.join(/* turbopackIgnore: true */ backupRoot, "logs/export.log"), "utf8");
    return content
      .split("\n")
      .filter((line) => line.trim().length > 0)
      .map(parseLogLine)
      .filter((entry): entry is BackupLogEntry => entry !== null)
      .slice(-limit);
  } catch {
    return [];
  }
}

/**
 * Calcula el porcentaje de progreso de un backup basándose en el estado de cada módulo.
 *
 * Usa un sistema de puntuación ponderada donde cada módulo contribuye según su estado:
 * - `complete` → 1.0 (100%)
 * - `partial` → 0.65 (65%)
 * - Cualquier otro estado (o no presente) → 0.0 (0%)
 *
 * El resultado final es la suma de puntos dividida por el número total de módulos,
 * redondeado al entero más cercano (0-100). Si no hay módulos, devuelve 0.
 *
 * @param moduleStatus - Objeto que mapea nombres de módulos a sus estados ("complete",
 *   "partial", "failed", etc.).
 * @returns Porcentaje de progreso como número entero entre 0 y 100.
 */
function calculateProgress(moduleStatus: Record<string, string>): number {
  const statuses = Object.values(moduleStatus);

  if (statuses.length === 0) {
    return 0;
  }

  const score = statuses.reduce((total, status) => {
    if (status === "complete") {
      return total + 1;
    }

    if (status === "partial") {
      return total + 0.65;
    }

    return total;
  }, 0);

  return Math.round((score / statuses.length) * 100);
}

function parseLogLine(line: string): BackupLogEntry | null {
  try {
    const raw = JSON.parse(line) as Record<string, unknown>;
    const level = String(raw.level ?? "info").toUpperCase();

    return {
      timestamp: typeof raw.timestamp === "string" ? raw.timestamp : new Date(0).toISOString(),
      level: level === "ERROR" ? "ERROR" : level === "WARN" ? "WARN" : "INFO",
      message: typeof raw.message === "string" ? raw.message : "Log entry",
      data: isRecord(raw.data) ? raw.data : {},
    };
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isBackupSummary(value: BackupSummary | null): value is BackupSummary {
  return value !== null;
}

/**
 * Resuelve la ruta absoluta de un backup validando que el ID sea seguro
 * y que la ruta resultante no escape del directorio de salida configurado.
 *
 * @param outputDir - Directorio raíz donde se almacenan los backups.
 * @param backupId - Identificador del backup a resolver.
 * @returns La ruta absoluta validada del directorio del backup.
 */
export function resolveManagedBackupPath(outputDir: string, backupId: string): string {
  if (!isSafeBackupId(backupId)) {
    throw new Error("Invalid backup ID.");
  }

  const root = path.resolve(/* turbopackIgnore: true */ outputDir);
  const backupRoot = path.resolve(/* turbopackIgnore: true */ root, backupId);

  if (!backupRoot.startsWith(`${root}${path.sep}`)) {
    throw new Error("Backup path escapes the configured output directory.");
  }

  return backupRoot;
}

function isSafeBackupId(value: string): boolean {
  return /^[A-Za-z0-9._-]+$/.test(value);
}

async function readManifest(manifestPath: string): Promise<BackupManifest | null> {
  try {
    return JSON.parse(await readFile(manifestPath, "utf8")) as BackupManifest;
  } catch {
    return null;
  }
}
