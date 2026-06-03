import { describe, expect, it } from "vitest";

import { createBackupId } from "./paths";

describe("createBackupId", () => {
  it("creates filesystem-safe backup IDs with project ID and module", () => {
    const backupId = createBackupId("project123", new Date("2026-06-01T13:00:00.000Z"), "all");

    expect(backupId).toBe("2026-06-01T13-00-00Z_all_project123");
  });

  it("defaults to 'all' when no module specified", () => {
    const backupId = createBackupId("project123", new Date("2026-06-01T13:00:00.000Z"));

    expect(backupId).toBe("2026-06-01T13-00-00Z_all_project123");
  });

  it("includes module type in backup ID", () => {
    const authId = createBackupId("p1", new Date("2026-06-01T13:00:00.000Z"), "auth");
    const dbId = createBackupId("p1", new Date("2026-06-01T13:00:00.000Z"), "databases");
    const stoId = createBackupId("p1", new Date("2026-06-01T13:00:00.000Z"), "storage");

    expect(authId).toBe("2026-06-01T13-00-00Z_auth_p1");
    expect(dbId).toBe("2026-06-01T13-00-00Z_databases_p1");
    expect(stoId).toBe("2026-06-01T13-00-00Z_storage_p1");
  });
});
