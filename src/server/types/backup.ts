export type BackupModule = "project" | "auth" | "databases" | "storage";

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

export type BackupManifest = {
  formatVersion: string;
  exportedAt: string;
  appwriteVersion?: string;
  endpoint: string;
  projectId: string;
  projectName?: string;
  modules: BackupModule[];
  counts: BackupCounts;
  restoreOrder: BackupModule[];
  warnings: string[];
  checksums: Record<string, string>;
  moduleStatus?: Record<string, "complete" | "partial" | "failed">;
};
