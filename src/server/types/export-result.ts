/** Advertencia generada durante un proceso de export. */
export type ExportWarning = {
  /** Código identificador del tipo de advertencia. */
  code: string;
  /** Descripción legible de la advertencia. */
  message: string;
  /** Módulo donde se originó la advertencia (auth, databases, storage, etc.). */
  module?: string;
  /** ID del recurso específico relacionado con la advertencia. */
  resourceId?: string;
};

/**
 * Resultado genérico de un proceso de export de un módulo.
 * @template TData - Tipo de los datos exportados.
 */
export type ExportResult<TData> = {
  /** Nombre del módulo exportado. */
  module: string;
  /** Timestamp ISO 8601 de cuándo se realizó el export. */
  exportedAt: string;
  /** Datos exportados (tipo genérico según el módulo). */
  data: TData;
  /** Advertencias encontradas durante el export. */
  warnings: ExportWarning[];
};
