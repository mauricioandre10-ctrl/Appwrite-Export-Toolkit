import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

describe("schedules lock", () => {
  let tempDir: string;
  let originalEnv: string | undefined;

  beforeEach(() => {
    tempDir = mkdtempSync(path.join(tmpdir(), "aet-lock-"));
    originalEnv = process.env.BACKUP_OUTPUT_DIR;
    process.env.BACKUP_OUTPUT_DIR = tempDir;
  });

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.BACKUP_OUTPUT_DIR;
    } else {
      process.env.BACKUP_OUTPUT_DIR = originalEnv;
    }
    if (existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("acquires and releases lock atomically", async () => {
    const { resetSchedulesDirCache } = await import("./storage");
    resetSchedulesDirCache();
    const { acquireLock, isLocked, releaseLock } = await import("./lock");

    expect(acquireLock("sch_abc")).toBe(true);
    expect(isLocked("sch_abc")).toBe(true);
    expect(acquireLock("sch_abc")).toBe(false);

    releaseLock("sch_abc");
    expect(isLocked("sch_abc")).toBe(false);

    expect(acquireLock("sch_abc")).toBe(true);
    releaseLock("sch_abc");
  });

  it("supports multiple distinct lock IDs", async () => {
    const { resetSchedulesDirCache } = await import("./storage");
    resetSchedulesDirCache();
    const { acquireLock, releaseLock } = await import("./lock");

    expect(acquireLock("sch_one")).toBe(true);
    expect(acquireLock("sch_two")).toBe(true);

    releaseLock("sch_one");
    expect(acquireLock("sch_one")).toBe(true);

    releaseLock("sch_two");
    releaseLock("sch_one");
  });
});
