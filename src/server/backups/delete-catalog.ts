import { readdir, stat, rm } from "node:fs/promises";
import path from "node:path";

import type { BackupManifest } from "../types/backup";
import { resolveManagedBackupPath } from "./catalog";

export type BackupDeletionInfo = {
  backupId: string;
  backupRoot: string;
  exportedAt: string;
  projectId: string;
  modules: string[];
  totalSizeBytes: number;
  fileCount: number;
};

/**
 * Obtiene la información necesaria para eliminar un backup,
 * incluyendo su tamaño total y cantidad de archivos.
 *
 * @param outputDir - Directorio raíz donde se encuentran los backups.
 * @param backupId - Identificador del backup a consultar.
 * @returns Información detallada del backup para procesos de eliminación.
 */
export async function getBackupDeletionInfo(outputDir: string, backupId: string): Promise<BackupDeletionInfo> {
  const backupRoot = resolveManagedBackupPath(outputDir, backupId);
  const manifestPath = path.join(backupRoot, "manifest.json");

  let manifest: BackupManifest;
  try {
    manifest = JSON.parse(await import("node:fs/promises").then((fs) => fs.readFile(manifestPath, "utf8"))) as BackupManifest;
  } catch {
    throw new Error(`No se encontro manifest para backup ${backupId}`);
  }

  const { size, files } = await measureDirectory(backupRoot);

  return {
    backupId,
    backupRoot,
    exportedAt: manifest.exportedAt,
    projectId: manifest.projectId,
    modules: [...manifest.modules],
    totalSizeBytes: size,
    fileCount: files,
  };
}

/**
 * Elimina un backup completo del disco, incluyendo todos sus archivos y directorios.
 *
 * @param outputDir - Directorio raíz donde se encuentran los backups.
 * @param backupId - Identificador del backup a eliminar.
 */
export async function deleteBackup(outputDir: string, backupId: string): Promise<void> {
  const backupRoot = resolveManagedBackupPath(outputDir, backupId);
  await rm(backupRoot, { recursive: true, force: true });
}

async function measureDirectory(dirPath: string): Promise<{ size: number; files: number }> {
  let totalSize = 0;
  let fileCount = 0;

  async function walk(currentPath: string): Promise<void> {
    const entries = await readdir(currentPath, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(currentPath, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath);
      } else {
        const s = await stat(fullPath);
        totalSize += s.size;
        fileCount += 1;
      }
    }
  }

  await walk(dirPath);
  return { size: totalSize, files: fileCount };
}

/**
 * Convierte una cantidad de bytes a una cadena legible con la unidad adecuada (B, KB, MB, etc.).
 *
 * @param bytes - Cantidad de bytes a formatear.
 * @returns Cadena con el valor formateado y su unidad.
 */
export function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB", "PB"];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / 1024 ** i).toFixed(1)} ${units[i]}`;
}
