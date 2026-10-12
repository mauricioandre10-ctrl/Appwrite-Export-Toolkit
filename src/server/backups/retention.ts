import { logger } from "../utils/logger";
import { listBackupSummaries } from "./catalog";
import { deleteBackup } from "./delete-catalog";

/** Resultado de una pasada de retención: backups eliminados y backups conservados (IDs). */
export type RetentionResult = {
  removed: string[];
  kept: string[];
};

/**
 * Aplica la política de retención: conserva los `maxRetention` backups más recientes
 * y elimina los excedentes (los más antiguos).
 *
 * `listBackupSummaries` devuelve los backups ordenados del más reciente al más antiguo,
 * por lo que los primeros `maxRetention` se conservan y el resto se elimina.
 *
 * @param outputDir - Directorio raíz donde se almacenan los backups.
 * @param maxRetention - Número máximo de copias a conservar. `0` desactiva la retención.
 * @returns Los IDs de los backups eliminados y conservados.
 * @throws {Error} Si `maxRetention` no es un entero no negativo.
 */
export async function pruneRetainedBackups(outputDir: string, maxRetention: number): Promise<RetentionResult> {
  if (!Number.isInteger(maxRetention) || maxRetention < 0) {
    throw new Error("maxRetention must be a non-negative integer");
  }

  if (maxRetention === 0) {
    return { removed: [], kept: [] };
  }

  const summaries = await listBackupSummaries(outputDir);
  const kept = summaries.slice(0, maxRetention).map((summary) => summary.backupId);
  const toDelete = summaries.slice(maxRetention);

  const removed: string[] = [];

  for (const summary of toDelete) {
    try {
      await deleteBackup(outputDir, summary.backupId);
      removed.push(summary.backupId);
      logger.info({ backupId: summary.backupId }, "Backup removed by retention policy");
    } catch (error) {
      const reason = error instanceof Error ? error.message : "Unknown error";
      logger.warn({ backupId: summary.backupId, reason }, "Failed to remove backup during retention prune");
    }
  }

  return { removed, kept };
}