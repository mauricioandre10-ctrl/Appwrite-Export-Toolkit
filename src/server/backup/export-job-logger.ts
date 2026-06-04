import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";

import { stringifyNdjson } from "../utils/json";

/** Nivel de severidad de una entrada de log del job de exportación. */
export type ExportJobLogLevel = "info" | "warn" | "error";

/**
 * Logger que persiste eventos de un job de exportación en formato NDJSON dentro de logs/export.log.
 *
 * Cada entrada se serializa como una línea JSON con timestamp ISO 8601, nivel de severidad,
 * mensaje descriptivo y datos opcionales. El archivo se crea automáticamente bajo
 * `{rootDir}/logs/export.log` con `appendFile`, por lo que múltiples jobs escriben
 * en el mismo archivo de forma segura.
 *
 * @example
 * ```ts
 * const logger = new ExportJobLogger("/backups/my-project");
 * await logger.info("Export started", { module: "auth" });
 * await logger.error("Export failed", { error: "timeout" });
 * ```
 */
export class ExportJobLogger {
  private readonly logPath: string;

  constructor(private readonly rootDir: string) {
    this.logPath = path.join(rootDir, "logs/export.log");
  }

  /**
   * Registra un mensaje de nivel info.
   *
   * Usar para eventos normales del ciclo de vida: inicio de export, progreso, completado, etc.
   *
   * @param message - Descripción legible del evento.
   * @param data - Datos adicionales opcionales que se serializan junto al mensaje.
   *
   * @errors
   * - Lanza excepción si falla la creación del directorio o la escritura en disco.
   */
  async info(message: string, data?: Record<string, unknown>): Promise<void> {
    await this.write("info", message, data);
  }

  /**
   * Registra un mensaje de nivel warn.
   *
   * Usar para situaciones no críticas pero inusuales: campos redactados, archivos vacíos,
   * reintentos, etc.
   *
   * @param message - Descripción legible de la advertencia.
   * @param data - Datos adicionales opcionales que se serializan junto al mensaje.
   *
   * @errors
   * - Lanza excepción si falla la creación del directorio o la escritura en disco.
   */
  async warn(message: string, data?: Record<string, unknown>): Promise<void> {
    await this.write("warn", message, data);
  }

  /**
   * Registra un mensaje de nivel error.
   *
   * Usar para fallos que impiden la exportación: archivos inaccesibles, errores de red,
   * validaciones fallidas, etc.
   *
   * @param message - Descripción legible del error.
   * @param data - Datos adicionales opcionales (stack trace, IDs, etc.) que se serializan junto al mensaje.
   *
   * @errors
   * - Lanza excepción si falla la creación del directorio o la escritura en disco.
   */
  async error(message: string, data?: Record<string, unknown>): Promise<void> {
    await this.write("error", message, data);
  }

  private async write(level: ExportJobLogLevel, message: string, data?: Record<string, unknown>): Promise<void> {
    await mkdir(path.dirname(this.logPath), { recursive: true });
    await appendFile(
      this.logPath,
      stringifyNdjson({
        timestamp: new Date().toISOString(),
        level,
        message,
        data: data ?? {},
      }),
      "utf8",
    );
  }
}
