/** Módulos disponibles para exportar/importar en un backup de Appwrite. */
export type BackupModule = "project" | "auth" | "databases" | "storage";

/**
 * Conteo de recursos exportados por tipo.
 * Cada campo representa la cantidad de elementos exportados de esa categoría.
 */
export type BackupCounts = {
  users?: number;
  teams?: number;
  memberships?: number;
  databases?: number;
  collections?: number;
  documents?: number;
  buckets?: number;
  files?: number;
  functions?: number;
  providers?: number;
  topics?: number;
  messages?: number;
};

/**
 * Manifiesto que describe un backup completo de Appwrite.
 * Contiene metadatos del export, conteos de recursos, orden de restauración y checksums de integridad.
 */
export type BackupManifest = {
  /** Versión del formato de export. */
  formatVersion: string;
  /** Timestamp ISO 8601 de cuándo se realizó el export. */
  exportedAt: string;
  /** Versión de Appwrite de origen (si se pudo determinar). */
  appwriteVersion?: string;
  /** Endpoint del servidor Appwrite del que se exportó. */
  endpoint: string;
  /** ID del proyecto de Appwrite exportado. */
  projectId: string;
  /** Nombre del proyecto de Appwrite exportado. */
  projectName?: string;
  /** Módulos que fueron exportados en este backup. */
  modules: BackupModule[];
  /** Conteo de recursos exportados por tipo. */
  counts: BackupCounts;
  /** Orden recomendado para restaurar los módulos durante el import. */
  restoreOrder: BackupModule[];
  /** Advertencias encontradas durante el proceso de export. */
  warnings: string[];
  /** Checksums SHA-256 de los archivos exportados, indexados por nombre. */
  checksums: Record<string, string>;
  /** Estado de cada módulo exportado (completo, parcial o fallido). */
  moduleStatus?: Record<string, "complete" | "partial" | "failed">;
};
