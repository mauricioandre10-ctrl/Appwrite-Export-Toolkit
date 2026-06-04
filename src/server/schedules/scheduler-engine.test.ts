/**
 * Tests para el scheduler-engine — verifica el registro y desregistro de schedules,
 * el cálculo de la próxima ejecución y la validación de expresiones cron inválidas.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

describe("scheduler-engine", () => {
  let tempDir: string;
  let originalEnv: string | undefined;

  beforeEach(() => {
    tempDir = mkdtempSync(path.join(tmpdir(), "aet-engine-"));
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

  it("registers and unregisters a schedule", async () => {
    const { resetSchedulesDirCache, createSchedule, deleteSchedule } = await import("./storage");
    resetSchedulesDirCache();
    const { register, unregister, isRegistered, shutdown } = await import("./scheduler-engine");

    const created = createSchedule({
      name: "Test",
      cronExpression: "0 0 * * *",
      timezone: "UTC",
      module: "all",
      target: "source",
      enabled: true,
    });

    expect(register(created)).toBe(true);
    expect(isRegistered(created.id)).toBe(true);
    expect(unregister(created.id)).toBe(true);
    expect(isRegistered(created.id)).toBe(false);

    deleteSchedule(created.id);
    shutdown();
  });

  it("computes next run in the future", async () => {
    const { resetSchedulesDirCache } = await import("./storage");
    resetSchedulesDirCache();
    const { getNextRun } = await import("./scheduler-engine");

    const next = getNextRun({
      id: "sch_x",
      name: "test",
      cronExpression: "0 0 * * *",
      timezone: "UTC",
      module: "all",
      target: "source",
      enabled: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      history: [],
    });

    expect(next).toBeDefined();
    expect(new Date(next!).getTime()).toBeGreaterThan(Date.now());
  });

  it("rejects invalid cron expressions gracefully", async () => {
    const { resetSchedulesDirCache } = await import("./storage");
    resetSchedulesDirCache();
    const { register, isRegistered, shutdown } = await import("./scheduler-engine");

    const ok = register({
      id: "sch_invalid",
      name: "bad",
      cronExpression: "this is not cron",
      timezone: "UTC",
      module: "all",
      target: "source",
      enabled: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      history: [],
    });

    expect(ok).toBe(false);
    expect(isRegistered("sch_invalid")).toBe(false);
    shutdown();
  });
});
