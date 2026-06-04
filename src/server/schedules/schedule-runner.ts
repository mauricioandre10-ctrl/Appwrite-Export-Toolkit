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

/**
 * Tipo que representa el resultado de ejecutar un export programado.
 * Contiene información sobre el éxito de la operación, el job creado y un resumen opcional.
 */
export type ScheduleRunResult = {
  /** Indica si la ejecución fue exitosa */
  success: boolean;
  /** ID del job creado para esta ejecución */
  jobId: string;
  /** Tipo de trigger que inició la ejecución (programado o manual) */
  trigger: ScheduleRunTrigger;
  /** Mensaje de error si la ejecución falló */
  errorMessage?: string;
  /** Resumen de la exportación si fue exitosa */
  summary?: BackupExportSummary;
};

/**
 * Tipo que define las opciones adicionales para ejecutar un export programado.
 */
export type RunOptions = {
  /**
   * Si se proporciona, el runner no asignará un nuevo jobId; usará este y saltará
   * la escritura inicial del placeholder en el historial (el caller ya lo escribió).
   * Útil cuando el caller quiere mostrar el jobId al cliente inmediatamente antes de que inicie la ejecución.
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

/**
 * Ejecuta un export programado o manual de Appwrite.
 * Maneja todo el ciclo de vida: creación del job, exportación, registro en historial y limpieza.
 *
 * @param schedule - Configuración del schedule a ejecutar con sus parámetros
 * @param trigger - Tipo de trigger que inicia la ejecución (por defecto "scheduled")
 * @param options - Opciones adicionales como jobId pre-asignado
 * @returns Resultado de la ejecución con información del job y resumen de la exportación
 */
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
