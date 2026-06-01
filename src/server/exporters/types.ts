import type { BackupCounts } from "../types/backup";

export type ModuleExportResult = {
  module: string;
  status: "complete" | "partial" | "failed";
  counts: BackupCounts;
  warnings: string[];
  files: string[];
};

export type JsonObject = Record<string, unknown>;
