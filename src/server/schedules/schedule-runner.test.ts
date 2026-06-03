import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const {
  exportBackupMock,
  parseExportSelectionMock,
  createJobIdMock,
  createJobMock,
  updateJobMock,
  completeJobMock,
  loadAppwriteConfigMock,
  loadTargetConfigMock,
} = vi.hoisted(() => ({
  exportBackupMock: vi.fn(),
  parseExportSelectionMock: vi.fn(() => ({ modules: ["auth"] as const })),
  createJobIdMock: vi.fn(async (kind: string) => `${kind}_2026-01-01T00-00-00Z_test`),
  createJobMock: vi.fn(async () => undefined),
  updateJobMock: vi.fn(async () => undefined),
  completeJobMock: vi.fn(async () => undefined),
  loadAppwriteConfigMock: vi.fn(() => ({ endpoint: "https://src", projectId: "src" })),
  loadTargetConfigMock: vi.fn(() => ({ endpoint: "https://tgt", projectId: "tgt" })),
}));

vi.mock("@/server/appwrite/client", () => ({
  createAppwriteServices: vi.fn(() => ({})),
}));

vi.mock("@/server/exporters/export-orchestrator", () => ({
  exportBackup: exportBackupMock,
  parseExportSelection: parseExportSelectionMock,
}));

vi.mock("@/server/import/progress-store", () => ({
  createJobId: createJobIdMock,
  createJob: createJobMock,
  updateJob: updateJobMock,
  completeJob: completeJobMock,
}));

vi.mock("@/server/appwrite/config", () => ({
  loadAppwriteConfig: loadAppwriteConfigMock,
  loadTargetConfig: loadTargetConfigMock,
}));

describe("schedule-runner", () => {
  let tempDir: string;
  let originalEnv: string | undefined;

  beforeEach(() => {
    tempDir = mkdtempSync(path.join(tmpdir(), "aet-runner-"));
    originalEnv = process.env.BACKUP_OUTPUT_DIR;
    process.env.BACKUP_OUTPUT_DIR = tempDir;

    exportBackupMock.mockReset();
    parseExportSelectionMock.mockClear();
    createJobIdMock.mockClear();
    createJobMock.mockClear();
    updateJobMock.mockClear();
    completeJobMock.mockClear();
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

  async function setupSchedule(name: string, target: "source" | "target" = "source") {
    const { resetSchedulesDirCache } = await import("./storage");
    resetSchedulesDirCache();
    const { createSchedule, getSchedule } = await import("./storage");
    const { clearCurrentJob } = await import("./running-jobs");
    clearCurrentJob("sch_test");

    const created = createSchedule({
      name,
      cronExpression: "0 0 * * *",
      timezone: "UTC",
      module: "all",
      target,
      enabled: true,
    });
    return { id: created.id, created, getSchedule };
  }

  it("writes a success run to history and clears currentJobs", async () => {
    const { id, getSchedule } = await setupSchedule("Manual OK");
    exportBackupMock.mockResolvedValueOnce({
      backupId: "bkp_test",
      modules: { auth: { users: 1 } },
    });

    const { runScheduledExport } = await import("./schedule-runner");
    const { getCurrentJob } = await import("./running-jobs");

    const result = await runScheduledExport(
      {
        id,
        name: "Manual OK",
        cronExpression: "0 0 * * *",
        timezone: "UTC",
        module: "all",
        target: "source",
        enabled: true,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        history: [],
      },
      "manual",
    );

    expect(result.success).toBe(true);
    expect(result.trigger).toBe("manual");
    expect(result.jobId).toMatch(/^export_/);
    expect(getCurrentJob(id)).toBeUndefined();

    // Runner writes placeholder (running) + final (success) — latest entry is the result.
    const fetched = getSchedule(id);
    expect(fetched?.history).toHaveLength(2);
    expect(fetched?.history[0]?.status).toBe("success");
    expect(fetched?.history[0]?.trigger).toBe("manual");
    expect(fetched?.history[0]?.durationMs).toBeGreaterThanOrEqual(0);
    expect(fetched?.history[0]?.jobId).toBe(result.jobId);
    expect(fetched?.history[1]?.status).toBe("running");
  });

  it("writes a failed run with the error message", async () => {
    const { id, getSchedule } = await setupSchedule("Will fail");
    exportBackupMock.mockRejectedValueOnce(new Error("boom"));

    const { runScheduledExport } = await import("./schedule-runner");
    const result = await runScheduledExport(
      {
        id,
        name: "Will fail",
        cronExpression: "0 0 * * *",
        timezone: "UTC",
        module: "auth",
        target: "source",
        enabled: true,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        history: [],
      },
      "scheduled",
    );

    expect(result.success).toBe(false);
    expect(result.errorMessage).toBe("boom");

    const fetched = getSchedule(id);
    expect(fetched?.history[0]?.status).toBe("failed");
    expect(fetched?.history[0]?.errorMessage).toBe("boom");
    expect(fetched?.history[0]?.trigger).toBe("scheduled");
  });

  it("uses a pre-allocated jobId without creating a new one and skips the placeholder write", async () => {
    const { id, getSchedule } = await setupSchedule("Prealloc");
    exportBackupMock.mockResolvedValueOnce({ backupId: "bkp_pre", modules: {} });

    const { runScheduledExport } = await import("./schedule-runner");
    const pre = "export_pre_allocated_42";
    const result = await runScheduledExport(
      {
        id,
        name: "Prealloc",
        cronExpression: "0 0 * * *",
        timezone: "UTC",
        module: "all",
        target: "source",
        enabled: true,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        history: [],
      },
      "manual",
      { preAllocatedJobId: pre },
    );

    expect(result.jobId).toBe(pre);
    expect(createJobIdMock).not.toHaveBeenCalled();

    const fetched = getSchedule(id);
    expect(fetched?.history).toHaveLength(1);
    expect(fetched?.history[0]?.status).toBe("success");
    expect(fetched?.history[0]?.jobId).toBe(pre);
  });

  it("selects target config when schedule.target is 'target'", async () => {
    const { id } = await setupSchedule("Target cfg", "target");
    exportBackupMock.mockResolvedValueOnce({ backupId: "bkp_tgt", modules: {} });

    loadAppwriteConfigMock.mockClear();
    loadTargetConfigMock.mockClear();

    const { runScheduledExport } = await import("./schedule-runner");
    const result = await runScheduledExport(
      {
        id,
        name: "Target cfg",
        cronExpression: "0 0 * * *",
        timezone: "UTC",
        module: "all",
        target: "target",
        enabled: true,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        history: [],
      },
      "scheduled",
    );

    expect(result.success).toBe(true);
    expect(loadTargetConfigMock).toHaveBeenCalled();
    expect(loadAppwriteConfigMock).not.toHaveBeenCalled();
  });
});
