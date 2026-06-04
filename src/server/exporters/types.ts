import type { BackupCounts } from "../types/backup";

/** Resultado del export de un módulo individual (auth, databases, storage, etc.). */
export type ModuleExportResult = {
  /** Nombre del módulo exportado. */
  module: string;
  /** Estado final del export: completo, parcial o fallido. */
  status: "complete" | "partial" | "failed";
  /** Conteo de recursos exportados por tipo. */
  counts: BackupCounts;
  /** Advertencias generadas durante el export de este módulo. */
  warnings: string[];
  /** Rutas de los archivos generados por el export. */
  files: string[];
};

/** Objeto JSON genérico con claves string y valores de cualquier tipo. */
export type JsonObject = Record<string, unknown>;
