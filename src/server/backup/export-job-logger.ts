import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";

import { stringifyNdjson } from "../utils/json";

/** Nivel de severidad de una entrada de log del job de exportación. */
export type ExportJobLogLevel = "info" | "warn" | "error";

/** Logger que persiste eventos de un job de exportación en formato NDJSON dentro de logs/export.log. */
export class ExportJobLogger {
  private readonly logPath: string;

  constructor(private readonly rootDir: string) {
    this.logPath = path.join(rootDir, "logs/export.log");
  }

  /** Registra un mensaje de nivel info. */
  async info(message: string, data?: Record<string, unknown>): Promise<void> {
    await this.write("info", message, data);
  }

  /** Registra un mensaje de nivel warn. */
  async warn(message: string, data?: Record<string, unknown>): Promise<void> {
    await this.write("warn", message, data);
  }

  /** Registra un mensaje de nivel error. */
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
