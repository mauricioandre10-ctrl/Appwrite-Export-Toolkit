import { createAppwriteServices } from "../appwrite/client";
import { loadAppwriteConfig, loadTargetConfig } from "../appwrite/config";
import {
  exportBackup,
  parseExportSelection,
  type BackupExportSummary,
  type ExportSelection,
} from "../exporters/export-orchestrator";
import { completeJob, createJob, createJobId, updateJob } from "../import/progress-store";
import { logger } from "../utils/logger";
import { clearCurrentJob, setCurrentJob } from "./running-jobs";
import { appendRun, getSchedule } from "./storage";
import type { Schedule, ScheduleRun, ScheduleRunTrigger } from "./types";

export type ScheduleRunResult = {
  success: boolean;
  jobId: string;
  trigger: ScheduleRunTrigger;
  errorMessage?: string;
  summary?: BackupExportSummary;
};

export type RunOptions = {
  /**
   * If provided, the runner will not allocate a new jobId; it uses this one and skips
   * the initial history placeholder write (caller already wrote it). Useful when the
   * caller wants to surface the jobId to the client immediately before the run starts.
   */
  preAllocatedJobId?: string;
};

function resolveConfig(target: Schedule["target"]): ReturnType<typeof loadAppwriteConfig> {
  return target === "target" ? loadTargetConfig() : loadAppwriteConfig();
}

function buildPlaceholderRun(startedAt: Date, trigger: ScheduleRunTrigger, jobId?: string): ScheduleRun {
  const run: ScheduleRun = {
    ranAt: startedAt.toISOString(),
    status: "running",
    trigger,
  };
  if (jobId !== undefined) {
    run.jobId = jobId;
  }
  return run;
}

function buildFinalRun(
  startedAt: Date,
  finishedAt: Date,
  trigger: ScheduleRunTrigger,
  status: ScheduleRun["status"],
  jobId: string,
  errorMessage?: string,
): ScheduleRun {
  const run: ScheduleRun = {
    ranAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    status,
    trigger,
    durationMs: finishedAt.getTime() - startedAt.getTime(),
    jobId,
  };
  if (errorMessage !== undefined) {
    run.errorMessage = errorMessage;
  }
  return run;
}

export async function runScheduledExport(
  schedule: Schedule,
  trigger: ScheduleRunTrigger = "scheduled",
  options: RunOptions = {},
): Promise<ScheduleRunResult> {
  // Re-read the schedule in case it was edited between trigger and execution.
  const current = getSchedule(schedule.id);
  const effective: Schedule = current ?? schedule;

  const startedAt = new Date();
  const jobId = options.preAllocatedJobId ?? (await createJobId("export"));
  const placeholder = buildPlaceholderRun(startedAt, trigger, jobId);

  // Register the running job so the panel can subscribe to live progress.
  setCurrentJob(effective.id, jobId);

  // If the caller didn't pre-allocate, write the placeholder + create the job file ourselves.
  if (options.preAllocatedJobId === undefined) {
    await createJob(jobId, "export");
    // Mark the job as "running" from the start so any concurrent SSE subscriber
    // (e.g., the schedule card observing live progress) doesn't see "pending"
    // and start its own duplicate export.
    await updateJob(jobId, {
      status: "running",
      module: effective.module,
      detail: `${trigger === "manual" ? "Manual run" : "Scheduled run"} de "${effective.name}"`,
    });
    appendRun(effective.id, placeholder);
  }

  logger.info(
    {
      id: effective.id,
      name: effective.name,
      module: effective.module,
      jobId,
      target: effective.target,
      trigger,
    },
    "Running scheduled export",
  );

  try {
    const config = resolveConfig(effective.target);
    const services = createAppwriteServices(config);
    const selection: ExportSelection = parseExportSelection(effective.module);

    const summary = await exportBackup({
      selection,
      config,
      services,
      jobId,
    });

    const finishedAt = new Date();
    await completeJob(jobId, summary);

    const finalRun = buildFinalRun(startedAt, finishedAt, trigger, "success", jobId);
    appendRun(effective.id, finalRun);

    logger.info(
      { id: effective.id, name: effective.name, status: "success", durationMs: finalRun.durationMs, jobId, trigger },
      "Schedule run finished",
    );

    return {
      success: true,
      jobId,
      trigger,
      summary,
    };
  } catch (err) {
    const finishedAt = new Date();
    const errorMessage = err instanceof Error ? err.message : String(err);

    await completeJob(jobId, undefined, errorMessage).catch(() => {});

    const failedRun = buildFinalRun(startedAt, finishedAt, trigger, "failed", jobId, errorMessage);
    appendRun(effective.id, failedRun);

    logger.error(
      { id: effective.id, name: effective.name, jobId, trigger, err: errorMessage, durationMs: failedRun.durationMs },
      "Schedule run failed",
    );

    return {
      success: false,
      jobId,
      trigger,
      errorMessage,
    };
  } finally {
    clearCurrentJob(effective.id);
  }
}
