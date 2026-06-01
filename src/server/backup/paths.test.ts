import { describe, expect, it } from "vitest";

import { createBackupId } from "./paths";

describe("createBackupId", () => {
  it("creates filesystem-safe backup IDs with project ID", () => {
    const backupId = createBackupId("project123", new Date("2026-06-01T13:00:00.000Z"));

    expect(backupId).toBe("2026-06-01T13-00-00Z_project123");
  });
});
