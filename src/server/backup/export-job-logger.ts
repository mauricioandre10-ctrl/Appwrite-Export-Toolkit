import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";

import { stringifyNdjson } from "../utils/json";

export type ExportJobLogLevel = "info" | "warn" | "error";

export class ExportJobLogger {
  private readonly logPath: string;

  constructor(private readonly rootDir: string) {
    this.logPath = path.join(rootDir, "logs/export.log");
  }

  async info(message: string, data?: Record<string, unknown>): Promise<void> {
    await this.write("info", message, data);
  }

  async warn(message: string, data?: Record<string, unknown>): Promise<void> {
    await this.write("warn", message, data);
  }

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
