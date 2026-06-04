import type { BackupManifest } from "../types/backup";

/**
 * Crea un manifiesto inicial vacío con los metadatos básicos del backup.
 *
 * Inicializa los campos con valores por defecto:
 * - `modules`: array vacío (se llena durante el export de cada módulo).
 * - `counts`: objeto vacío (se puebla con el conteo de recursos por tipo).
 * - `restoreOrder`: `["auth", "databases", "storage"]` — orden recomendado para restaurar.
 * - `warnings`: array vacío (se acumulan advertencias durante el export).
 * - `checksums`: objeto vacío (se puebla con hashes SHA-256 de archivos exportados).
 * - `exportedAt`: timestamp ISO 8601 de la fecha/hora actual del servidor.
 *
 * @param input - Datos del backup a exportar.
 * @param input.formatVersion - Versión del formato de export (ej: `"1.0.0"`).
 * @param input.endpoint - Endpoint del servidor Appwrite de origen.
 * @param input.projectId - ID del proyecto de Appwrite exportado.
 * @param input.appwriteVersion - Versión de Appwrite detectada en el servidor origen (opcional).
 * @returns Objeto `BackupManifest` con los metadatos inicializados y listo para poblar.
 */
export function createInitialManifest(input: {
  formatVersion: string;
  endpoint: string;
  projectId: string;
  appwriteVersion?: string;
}): BackupManifest {
  const manifest: BackupManifest = {
    formatVersion: input.formatVersion,
    exportedAt: new Date().toISOString(),
    endpoint: input.endpoint,
    projectId: input.projectId,
    modules: [],
    counts: {},
    restoreOrder: ["auth", "databases", "storage"],
    warnings: [],
    checksums: {},
  };

  if (input.appwriteVersion !== undefined) {
    manifest.appwriteVersion = input.appwriteVersion;
  }

  return manifest;
}
