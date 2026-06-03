import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, existsSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

describe("schedules storage", () => {
  let tempDir: string;
  let originalEnv: string | undefined;

  beforeEach(() => {
    tempDir = mkdtempSync(path.join(tmpdir(), "aet-schedules-"));
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

  it("persists schedules as JSON in BACKUP_OUTPUT_DIR/.schedules", async () => {
    const { resetSchedulesDirCache } = await import("./storage");
    resetSchedulesDirCache();

    const { createSchedule, listSchedules, getSchedulesDir: getDir } = await import("./storage");
    const dir = getDir();
    expect(dir).toBe(path.join(tempDir, ".schedules"));

    const created = createSchedule({
      name: "Backup nocturno",
      cronExpression: "0 0 * * *",
      timezone: "Europe/Madrid",
      module: "all",
      target: "source",
      enabled: true,
    });

    expect(created.id).toMatch(/^sch_[a-f0-9]+$/);
    expect(created.name).toBe("Backup nocturno");
    expect(created.history).toEqual([]);

    expect(existsSync(path.join(dir, `${created.id}.json`))).toBe(true);

    const all = listSchedules();
    expect(all).toHaveLength(1);
    expect(all[0]?.id).toBe(created.id);

    const raw = JSON.parse(readFileSync(path.join(dir, `${created.id}.json`), "utf-8"));
    expect(raw.name).toBe("Backup nocturno");
    expect(raw.cronExpression).toBe("0 0 * * *");
  });

  it("updates a schedule with patch and persists changes", async () => {
    const { resetSchedulesDirCache, createSchedule, updateSchedule, getSchedule } = await import("./storage");
    resetSchedulesDirCache();

    const created = createSchedule({
      name: "Original",
      cronExpression: "0 0 * * *",
      timezone: "UTC",
      module: "auth",
      target: "source",
      enabled: true,
    });

    await new Promise((resolve) => setTimeout(resolve, 5));

    const updated = updateSchedule(created.id, { name: "Renombrado", enabled: false });
    expect(updated).not.toBeNull();
    expect(updated?.name).toBe("Renombrado");
    expect(updated?.enabled).toBe(false);
    expect(new Date(updated!.updatedAt).getTime()).toBeGreaterThanOrEqual(new Date(created.updatedAt).getTime());

    const fetched = getSchedule(created.id);
    expect(fetched?.name).toBe("Renombrado");
    expect(fetched?.enabled).toBe(false);
  });

  it("deletes a schedule and removes the JSON file", async () => {
    const { resetSchedulesDirCache, createSchedule, deleteSchedule, getSchedule } = await import("./storage");
    resetSchedulesDirCache();

    const created = createSchedule({
      name: "ToDelete",
      cronExpression: "*/5 * * * *",
      timezone: "UTC",
      module: "databases",
      target: "source",
      enabled: true,
    });

    const filePath = path.join(resolveDir(), `${created.id}.json`);
    expect(existsSync(filePath)).toBe(true);

    expect(deleteSchedule(created.id)).toBe(true);
    expect(existsSync(filePath)).toBe(false);
    expect(getSchedule(created.id)).toBeNull();
  });

  it("appends runs to history and trims to HISTORY_LIMIT", async () => {
    const { resetSchedulesDirCache } = await import("./storage");
    resetSchedulesDirCache();
    const { createSchedule, appendRun, getSchedule } = await import("./storage");
    const { HISTORY_LIMIT } = await import("./types");

    const created = createSchedule({
      name: "History test",
      cronExpression: "0 0 * * *",
      timezone: "UTC",
      module: "all",
      target: "source",
      enabled: true,
    });

    for (let i = 0; i < HISTORY_LIMIT + 5; i += 1) {
      appendRun(created.id, {
        ranAt: new Date(2026, 0, 1, 0, 0, i).toISOString(),
        status: i % 2 === 0 ? "success" : "failed",
        trigger: "scheduled",
      });
    }

    const fetched = getSchedule(created.id);
    expect(fetched?.history).toHaveLength(HISTORY_LIMIT);
    expect(fetched?.lastRunAt).toBeDefined();
  });

  it("falls back to project .data when BACKUP_OUTPUT_DIR is not writable", async () => {
    const { resetSchedulesDirCache, getSchedulesDir } = await import("./storage");
    resetSchedulesDirCache();

    process.env.BACKUP_OUTPUT_DIR = "/this/does/not/exist/and/cannot/be/created";
    const dir = getSchedulesDir();
    expect(dir).toContain(".data");
    expect(dir).not.toContain(tmpdir());

    expect(readdirSync(dir).length).toBeGreaterThanOrEqual(0);

    resetSchedulesDirCache();
    process.env.BACKUP_OUTPUT_DIR = tempDir;
  });

  function resolveDir(): string {
    return path.join(tempDir, ".schedules");
  }
});
