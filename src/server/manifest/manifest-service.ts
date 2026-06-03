import type { BackupManifest } from "../types/backup";

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
