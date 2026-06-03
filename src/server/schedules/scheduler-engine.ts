import { Cron } from "croner";

import { logger } from "../utils/logger";
import { acquireLock, releaseLock } from "./lock";
import {
  getSchedule,
  listSchedules,
  setNextRun,
} from "./storage";
import type { Schedule } from "./types";

const jobs = new Map<string, Cron>();

function computeNextRun(schedule: Schedule): string | undefined {
  try {
    const next = new Cron(schedule.cronExpression, { timezone: schedule.timezone }).nextRun();
    return next ? next.toISOString() : undefined;
  } catch (err) {
    logger.warn(
      { id: schedule.id, err: err instanceof Error ? err.message : String(err) },
      "Failed to compute next run",
    );
    return undefined;
  }
}

async function handleTick(schedule: Schedule): Promise<void> {
  if (!acquireLock(schedule.id)) {
    logger.info({ id: schedule.id, name: schedule.name }, "Schedule skipped (already running)");
    return;
  }

  logger.info(
    { id: schedule.id, name: schedule.name, module: schedule.module, trigger: "scheduled" },
    "Schedule triggered (cron tick)",
  );

  try {
    const { runScheduledExport } = await import("./schedule-runner");
    await runScheduledExport(schedule, "scheduled");
  } catch (err) {
    logger.error(
      { id: schedule.id, name: schedule.name, err: err instanceof Error ? err.message : String(err) },
      "Schedule tick crashed (unexpected)",
    );
  } finally {
    releaseLock(schedule.id);
  }
}

function makeCron(schedule: Schedule): Cron {
  return new Cron(
    schedule.cronExpression,
    {
      name: `schedule-${schedule.id}`,
      timezone: schedule.timezone,
      protect: true,
    },
    () => {
      handleTick(schedule).catch((err) => {
        logger.error(
          { id: schedule.id, err: err instanceof Error ? err.message : String(err) },
          "Unhandled schedule tick error",
        );
      });
    },
  );
}

export function register(schedule: Schedule): boolean {
  if (jobs.has(schedule.id)) {
    unregister(schedule.id);
  }

  try {
    const cron = makeCron(schedule);
    jobs.set(schedule.id, cron);
    const nextRunAt = computeNextRun(schedule);
    setNextRun(schedule.id, nextRunAt);
    logger.info(
      { id: schedule.id, name: schedule.name, cron: schedule.cronExpression, timezone: schedule.timezone, nextRunAt },
      "Schedule registered",
    );
    return true;
  } catch (err) {
    logger.error(
      { id: schedule.id, cron: schedule.cronExpression, err: err instanceof Error ? err.message : String(err) },
      "Failed to register schedule (invalid cron expression?)",
    );
    return false;
  }
}

export function unregister(id: string): boolean {
  const cron = jobs.get(id);
  if (cron === undefined) return false;
  cron.stop();
  jobs.delete(id);
  setNextRun(id, undefined);
  logger.info({ id }, "Schedule unregistered");
  return true;
}

export function isRegistered(id: string): boolean {
  return jobs.has(id);
}

export function reloadAll(): { total: number; registered: number } {
  jobs.forEach((cron, id) => {
    cron.stop();
    jobs.delete(id);
  });

  const all = listSchedules();
  let registered = 0;
  for (const schedule of all) {
    if (!schedule.enabled) continue;
    if (register(schedule)) registered += 1;
  }
  logger.info({ total: all.length, registered }, "All schedules reloaded");
  return { total: all.length, registered };
}

export function bootstrap(): void {
  reloadAll();
}

export function getNextRun(schedule: Schedule): string | undefined {
  return computeNextRun(schedule);
}

export function refreshAfterPatch(id: string): void {
  const schedule = getSchedule(id);
  if (schedule === null) {
    unregister(id);
    return;
  }
  if (schedule.enabled) {
    register(schedule);
  } else {
    unregister(id);
  }
}

export function shutdown(): void {
  jobs.forEach((cron, id) => {
    cron.stop();
    logger.info({ id }, "Schedule stopped (shutdown)");
  });
  jobs.clear();
}

export function _debugList(): Array<{ id: string; isRunning: boolean }> {
  return Array.from(jobs.entries()).map(([id, cron]) => ({ id, isRunning: cron.isRunning() }));
}
