/**
 * Tests para el job-streamer — verifica el streaming SSE de jobs de export e import.
 * Valida que se ejecute la operación correcta según el estado del job (pending, running,
 * completed, failed), que se emitan eventos de progreso/complete/error correctamente,
 * y que un subscriber solo observe sin re-ejecutar cuando el job ya está en ejecución.
 */
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  exportBackupMock,
  importBackupMock,
  getJobMock,
  updateJobMock,
  completeJobMock,
  loadAppwriteConfigMock,
  loadTargetConfigMock,
} = vi.hoisted(() => ({
  exportBackupMock: vi.fn(),
  importBackupMock: vi.fn(),
  getJobMock: vi.fn(),
  updateJobMock: vi.fn(async () => undefined),
  completeJobMock: vi.fn(async () => undefined),
  loadAppwriteConfigMock: vi.fn(() => ({ endpoint: "https://src", projectId: "src" })),
  loadTargetConfigMock: vi.fn(() => ({ endpoint: "https://tgt", projectId: "tgt" })),
}));

vi.mock("@/server/exporters/export-orchestrator", () => ({
  exportBackup: exportBackupMock,
  parseExportSelection: vi.fn((v: string | undefined) => v ?? "all"),
}));

vi.mock("@/server/import/import-orchestrator", () => ({
  importBackup: importBackupMock,
  parseImportSelection: vi.fn((v: string | undefined) => v ?? "all"),
}));

vi.mock("@/server/appwrite/client", () => ({
  createAppwriteServices: vi.fn(() => ({})),
}));

vi.mock("@/server/appwrite/config", () => ({
  loadAppwriteConfig: loadAppwriteConfigMock,
  loadTargetConfig: loadTargetConfigMock,
}));

vi.mock("@/server/import/progress-store", () => ({
  getJob: getJobMock,
  updateJob: updateJobMock,
  completeJob: completeJobMock,
}));

type JobProgress = {
  jobId: string;
  type: "import" | "export";
  status: "pending" | "running" | "completed" | "failed";
  percent: number;
  phase: string;
  module: string;
  detail: string;
  startedAt: string;
  finishedAt: string;
  result?: unknown;
  error?: string;
};

type StreamEvent =
  | { event: "progress"; data: { jobId: string; percent: number; phase: string; module: string; detail: string } }
  | { event: "complete"; data: { jobId: string; status: "completed"; redirectUrl: string } }
  | { event: "error-event"; data: { jobId: string; error: string } };

function makeJob(overrides: Partial<JobProgress> = {}): JobProgress {
  return {
    jobId: "job_test_1",
    type: "export",
    status: "pending",
    percent: 0,
    phase: "preparando",
    module: "all",
    detail: "",
    startedAt: "2026-01-01T00:00:00.000Z",
    finishedAt: "",
    ...overrides,
  };
}

describe("job-streamer", () => {
  let tempDir: string;
  let originalEnv: string | undefined;
  let events: Array<StreamEvent["event"]>;
  let payloads: Array<StreamEvent["data"]>;

  beforeEach(() => {
    tempDir = mkdtempSync(path.join(tmpdir(), "aet-streamer-"));
    originalEnv = process.env.BACKUP_OUTPUT_DIR;
    process.env.BACKUP_OUTPUT_DIR = tempDir;
    mkdirSync(path.join(tempDir, ".jobs"), { recursive: true });

    events = [];
    payloads = [];
    exportBackupMock.mockReset();
    importBackupMock.mockReset();
    getJobMock.mockReset();
    updateJobMock.mockReset();
    completeJobMock.mockReset();
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

  function captureEmit() {
    return (event: StreamEvent["event"], data: StreamEvent["data"]) => {
      events.push(event);
      payloads.push(data);
    };
  }

  function writeJobFile(jobId: string, job: JobProgress) {
    const filePath = path.join(tempDir, ".jobs", `${jobId}.json`);
    writeFileSync(filePath, JSON.stringify(job, null, 2), "utf-8");
  }

  function readJobFile(jobId: string): JobProgress {
    const filePath = path.join(tempDir, ".jobs", `${jobId}.json`);
    return JSON.parse(readFileSync(filePath, "utf-8")) as JobProgress;
  }

  it("executes the export when status is pending and emits complete", async () => {
    const job = makeJob({ status: "pending", module: "all" });
    exportBackupMock.mockImplementation(async () => {
      writeJobFile(job.jobId, makeJob({ status: "running", percent: 50, phase: "exporting" }));
      return { backupId: "bkp_xyz" };
    });

    getJobMock.mockImplementation(async (jobId: string) => {
      const onDisk = readJobFile(jobId);
      return onDisk;
    });

    const { streamJob } = await import("./job-streamer");
    const emit = captureEmit();
    await streamJob(job.jobId, job, emit);

    expect(exportBackupMock).toHaveBeenCalledTimes(1);
    expect(events).toContain("complete");
    const complete = payloads.find((p) => events[payloads.indexOf(p)] === "complete") as
      | { jobId: string; status: "completed"; redirectUrl: string }
      | undefined;
    expect(complete?.redirectUrl).toContain("exported=bkp_xyz");
    // The export was called with the module from the job file, not the SSE's own module.
    expect(exportBackupMock.mock.calls[0]?.[0]?.selection).toBe("all");
  });

  it("does NOT execute the export when status is already running (observability only)", async () => {
    const job = makeJob({ status: "running", percent: 30, phase: "exporting", module: "auth" });
    let jobState: JobProgress = job;

    // Simulate the job becoming completed by a runner 2 polls later.
    const pollCount = { n: 0 };
    getJobMock.mockImplementation(async () => {
      pollCount.n += 1;
      if (pollCount.n === 2) {
        jobState = { ...jobState, status: "completed", percent: 100, phase: "completed", module: "all" };
        return jobState;
      }
      return jobState;
    });

    const { streamJob } = await import("./job-streamer");
    const emit = captureEmit();
    await streamJob(job.jobId, job, emit);

    expect(exportBackupMock).not.toHaveBeenCalled();
    expect(importBackupMock).not.toHaveBeenCalled();
    expect(events).toContain("progress");
    expect(events).toContain("complete");
  });

  it("emits complete immediately for a job that is already completed", async () => {
    const job = makeJob({
      status: "completed",
      percent: 100,
      result: { backupId: "bkp_done" },
    });

    const { streamJob } = await import("./job-streamer");
    const emit = captureEmit();
    await streamJob(job.jobId, job, emit);

    expect(exportBackupMock).not.toHaveBeenCalled();
    expect(importBackupMock).not.toHaveBeenCalled();
    expect(events).toEqual(["complete"]);
    const complete = payloads[0] as { redirectUrl: string };
    expect(complete.redirectUrl).toContain("exported=bkp_done");
  });

  it("emits error-event immediately for a job that is already failed", async () => {
    const job = makeJob({
      status: "failed",
      error: "boom",
    });

    const { streamJob } = await import("./job-streamer");
    const emit = captureEmit();
    await streamJob(job.jobId, job, emit);

    expect(exportBackupMock).not.toHaveBeenCalled();
    expect(importBackupMock).not.toHaveBeenCalled();
    expect(events).toEqual(["error-event"]);
    const err = payloads[0] as { error: string };
    expect(err.error).toBe("boom");
  });

  it("observes a running export job and emits progress + complete without executing", async () => {
    // Critical: this proves the duplicate-execution bug is fixed.
    // A schedule manual run creates 2 EventSource subscribers (card + feedback
    // banner). Without the gate, both would call exportBackup. With the gate,
    // only the runner executes; both subscribers just observe.
    const job = makeJob({
      status: "running",
      percent: 10,
      phase: "exporting",
      module: "auth",
    });

    let pollCount = 0;
    getJobMock.mockImplementation(async () => {
      pollCount += 1;
      if (pollCount === 1) {
        return { ...job, percent: 30, module: "auth" };
      }
      if (pollCount === 2) {
        return { ...job, percent: 60, module: "databases" };
      }
      // Terminal
      return {
        ...job,
        status: "completed",
        percent: 100,
        module: "all",
        result: { backupId: "bkp_runner_only" },
      };
    });

    const { streamJob } = await import("./job-streamer");
    const emit = captureEmit();
    await streamJob(job.jobId, job, emit);

    // The streamer did NOT start a new export — it only observed.
    expect(exportBackupMock).not.toHaveBeenCalled();

    // It did emit progress events as the job file changed.
    const progressPayloads = payloads.filter(
      (_, i) => events[i] === "progress",
    ) as Array<{ jobId: string; percent: number; phase: string; module: string; detail: string }>;
    expect(progressPayloads.length).toBeGreaterThanOrEqual(2);
    const percents = progressPayloads.map((p) => p.percent);
    expect(percents).toContain(30);
    expect(percents).toContain(60);

    // It emitted a final complete event with the runner's backupId.
    expect(events).toContain("complete");
    const completePayload = payloads.find(
      (_, i) => events[i] === "complete",
    ) as { redirectUrl: string };
    expect(completePayload.redirectUrl).toContain("exported=bkp_runner_only");
  });

  it("emits error-event when observing a running job that later fails", async () => {
    const job = makeJob({ status: "running", percent: 10, phase: "exporting" });

    let pollCount = 0;
    getJobMock.mockImplementation(async () => {
      pollCount += 1;
      if (pollCount <= 1) {
        return job;
      }
      return { ...job, status: "failed", error: "runner crashed" };
    });

    const { streamJob } = await import("./job-streamer");
    const emit = captureEmit();
    await streamJob(job.jobId, job, emit);

    expect(exportBackupMock).not.toHaveBeenCalled();
    expect(events).toContain("error-event");
    const errPayload = payloads.find((_, i) => events[i] === "error-event") as { error: string };
    expect(errPayload.error).toBe("runner crashed");
  });

  it("import path: executes the import when status is pending", async () => {
    const job = makeJob({
      jobId: "job_imp_1",
      type: "import",
      status: "pending",
      module: "auth",
      result: "bkp_to_import",
    });
    importBackupMock.mockResolvedValue({ status: "complete" });

    const { streamJob } = await import("./job-streamer");
    const emit = captureEmit();
    await streamJob(job.jobId, job, emit);

    expect(importBackupMock).toHaveBeenCalledTimes(1);
    expect(importBackupMock.mock.calls[0]?.[0]?.backupPath).toBe("bkp_to_import");
    expect(events).toContain("complete");
    const complete = payloads.find((_, i) => events[i] === "complete") as { redirectUrl: string };
    expect(complete.redirectUrl).toContain("imported=bkp_to_import");
    expect(complete.redirectUrl).toContain("importStatus=complete");
  });

  it("does not call exportBackup when job file vanishes mid-observation", async () => {
    const job = makeJob({ status: "running" });
    let pollCount = 0;
    getJobMock.mockImplementation(async () => {
      pollCount += 1;
      if (pollCount === 1) return job;
      return undefined;
    });

    const { streamJob } = await import("./job-streamer");
    const emit = captureEmit();
    await streamJob(job.jobId, job, emit);

    expect(exportBackupMock).not.toHaveBeenCalled();
    expect(events).toContain("error-event");
  });
});
