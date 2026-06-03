import { z } from "zod";

export const scheduleModuleSchema = z.enum(["all", "auth", "databases", "storage"]);
export type ScheduleModule = z.infer<typeof scheduleModuleSchema>;

export const scheduleTargetSchema = z.enum(["source", "target"]);
export type ScheduleTarget = z.infer<typeof scheduleTargetSchema>;

export const scheduleRunStatusSchema = z.enum(["success", "failed", "running"]);
export type ScheduleRunStatus = z.infer<typeof scheduleRunStatusSchema>;

export const scheduleRunTriggerSchema = z.enum(["manual", "scheduled"]);
export type ScheduleRunTrigger = z.infer<typeof scheduleRunTriggerSchema>;

export const scheduleRunSchema = z.object({
  ranAt: z.string().min(1),
  finishedAt: z.string().optional(),
  status: scheduleRunStatusSchema,
  trigger: scheduleRunTriggerSchema.default("scheduled"),
  jobId: z.string().optional(),
  durationMs: z.number().int().nonnegative().optional(),
  errorMessage: z.string().optional(),
});
export type ScheduleRun = z.infer<typeof scheduleRunSchema>;

export const scheduleSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(100),
  cronExpression: z.string().min(1).max(120),
  timezone: z.string().min(1).max(80),
  module: scheduleModuleSchema,
  target: scheduleTargetSchema,
  enabled: z.boolean(),
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
  lastRunAt: z.string().optional(),
  lastRunStatus: scheduleRunStatusSchema.optional(),
  lastRunJobId: z.string().optional(),
  nextRunAt: z.string().optional(),
  history: z.array(scheduleRunSchema).max(50).default([]),
});
export type Schedule = z.infer<typeof scheduleSchema>;

export const scheduleInputSchema = z.object({
  name: z.string().min(1).max(100),
  cronExpression: z.string().min(1).max(120),
  timezone: z.string().min(1).max(80),
  module: scheduleModuleSchema.default("all"),
  target: scheduleTargetSchema.default("source"),
  enabled: z.boolean().default(true),
});
export type ScheduleInput = z.infer<typeof scheduleInputSchema>;

export const schedulePatchSchema = z
  .object({
    name: z.string().min(1).max(100).optional(),
    cronExpression: z.string().min(1).max(120).optional(),
    timezone: z.string().min(1).max(80).optional(),
    module: scheduleModuleSchema.optional(),
    target: scheduleTargetSchema.optional(),
    enabled: z.boolean().optional(),
  })
  .strict();
export type SchedulePatch = z.infer<typeof schedulePatchSchema>;

export type ScheduleSummary = Pick<
  Schedule,
  | "id"
  | "name"
  | "cronExpression"
  | "timezone"
  | "module"
  | "target"
  | "enabled"
  | "createdAt"
  | "updatedAt"
  | "lastRunAt"
  | "lastRunStatus"
  | "lastRunJobId"
  | "nextRunAt"
>;

export const HISTORY_LIMIT = 20;
