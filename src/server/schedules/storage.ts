import { mkdirSync, accessSync, readFileSync, writeFileSync, readdirSync, rmSync, renameSync, statSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { randomUUID } from "node:crypto";

import {
  HISTORY_LIMIT,
  type Schedule,
  type ScheduleInput,
  type SchedulePatch,
  type ScheduleSummary,
  type ScheduleRun,
  type ScheduleRunStatus,
  scheduleSchema,
} from "./types";
import { logger } from "../utils/logger";

const SCHEDULES_DIRNAME = ".schedules";

let cachedDir: string | null = null;

function resolveSchedulesDir(): string {
  if (cachedDir !== null) return cachedDir;

  const candidates = [
    process.env.BACKUP_OUTPUT_DIR,
    "/data",
    path.resolve(process.cwd(), ".data"),
    os.tmpdir(),
  ].filter((value): value is string => typeof value === "string" && value.length > 0);

  for (const candidate of candidates) {
    const resolved = path.resolve(candidate, SCHEDULES_DIRNAME);
    try {
      mkdirSync(resolved, { recursive: true });
      accessSync(resolved);
      cachedDir = resolved;
      logger.info({ dir: resolved, source: candidate }, "Schedules directory resolved");
      return resolved;
    } catch {
      // try next candidate
    }
  }

  const fallback = path.join(os.tmpdir(), SCHEDULES_DIRNAME);
  mkdirSync(fallback, { recursive: true });
  cachedDir = fallback;
  logger.warn({ dir: fallback }, "Schedules directory fell back to tmp");
  return fallback;
}

function scheduleFilePath(id: string): string {
  const safe = id.replace(/[^a-zA-Z0-9_-]/g, "_");
  return path.join(resolveSchedulesDir(), `${safe}.json`);
}

function parseScheduleFile(filePath: string): Schedule | null {
  try {
    const raw = readFileSync(filePath, "utf-8");
    const parsed = JSON.parse(raw) as unknown;
    const result = scheduleSchema.safeParse(parsed);
    if (!result.success) {
      logger.warn({ filePath, issues: result.error.issues }, "Skipping invalid schedule file");
      return null;
    }
    return result.data;
  } catch (err) {
    logger.warn({ filePath, err: err instanceof Error ? err.message : String(err) }, "Failed to read schedule file");
    return null;
  }
}

function toSummary(schedule: Schedule): ScheduleSummary {
  return {
    id: schedule.id,
    name: schedule.name,
    cronExpression: schedule.cronExpression,
    timezone: schedule.timezone,
    module: schedule.module,
    target: schedule.target,
    enabled: schedule.enabled,
    createdAt: schedule.createdAt,
    updatedAt: schedule.updatedAt,
    lastRunAt: schedule.lastRunAt,
    lastRunStatus: schedule.lastRunStatus,
    lastRunJobId: schedule.lastRunJobId,
    nextRunAt: schedule.nextRunAt,
  };
}

export function listSchedules(): Schedule[] {
  const dir = resolveSchedulesDir();
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return [];
  }

  const schedules: Schedule[] = [];
  for (const entry of entries) {
    if (!entry.endsWith(".json")) continue;
    const filePath = path.join(dir, entry);
    try {
      const stat = statSync(filePath);
      if (!stat.isFile()) continue;
    } catch {
      continue;
    }
    const schedule = parseScheduleFile(filePath);
    if (schedule !== null) schedules.push(schedule);
  }

  schedules.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  return schedules;
}

export function listScheduleSummaries(): ScheduleSummary[] {
  return listSchedules().map(toSummary);
}

export function getSchedule(id: string): Schedule | null {
  const filePath = scheduleFilePath(id);
  return parseScheduleFile(filePath);
}

function persistSchedule(schedule: Schedule): Schedule {
  const validated = scheduleSchema.parse(schedule);
  const filePath = scheduleFilePath(schedule.id);
  const tmpPath = `${filePath}.tmp`;
  writeFileSync(tmpPath, JSON.stringify(validated, null, 2), "utf-8");
  renameSync(tmpPath, filePath);
  return validated;
}

export function createSchedule(input: ScheduleInput): Schedule {
  const now = new Date().toISOString();
  const id = `sch_${randomUUID().replace(/-/g, "").slice(0, 16)}`;

  const schedule: Schedule = {
    id,
    name: input.name,
    cronExpression: input.cronExpression,
    timezone: input.timezone,
    module: input.module,
    target: input.target,
    enabled: input.enabled,
    createdAt: now,
    updatedAt: now,
    history: [],
  };

  return persistSchedule(schedule);
}

export function updateSchedule(id: string, patch: SchedulePatch): Schedule | null {
  const current = getSchedule(id);
  if (current === null) return null;

  const next: Schedule = {
    ...current,
    name: patch.name ?? current.name,
    cronExpression: patch.cronExpression ?? current.cronExpression,
    timezone: patch.timezone ?? current.timezone,
    module: patch.module ?? current.module,
    target: patch.target ?? current.target,
    enabled: patch.enabled ?? current.enabled,
    updatedAt: new Date().toISOString(),
  };

  return persistSchedule(next);
}

export function deleteSchedule(id: string): boolean {
  const filePath = scheduleFilePath(id);
  try {
    rmSync(filePath, { force: true });
    return true;
  } catch (err) {
    logger.warn({ id, err: err instanceof Error ? err.message : String(err) }, "Failed to delete schedule file");
    return false;
  }
}

export function appendRun(id: string, run: ScheduleRun): Schedule | null {
  const current = getSchedule(id);
  if (current === null) return null;

  const history = [run, ...current.history].slice(0, HISTORY_LIMIT);
  const lastRunAt = run.ranAt;
  const lastRunStatus: ScheduleRunStatus = run.status;
  const lastRunJobId = run.jobId;

  return persistSchedule({
    ...current,
    history,
    lastRunAt,
    lastRunStatus,
    lastRunJobId,
    updatedAt: new Date().toISOString(),
  });
}

export function setNextRun(id: string, nextRunAt: string | undefined): Schedule | null {
  const current = getSchedule(id);
  if (current === null) return null;

  const next: Schedule = {
    ...current,
    nextRunAt,
    updatedAt: new Date().toISOString(),
  };

  return persistSchedule(next);
}

export function getSchedulesDir(): string {
  return resolveSchedulesDir();
}

export function resetSchedulesDirCache(): void {
  cachedDir = null;
}
