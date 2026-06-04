import { z } from "zod";

/** Esquema Zod para los módulos programables: todos, autenticación, bases de datos o almacenamiento. */
export const scheduleModuleSchema = z.enum(["all", "auth", "databases", "storage"]);
/** Módulos sobre los que se puede programar un backup: todos, autenticación, bases de datos o almacenamiento. */
export type ScheduleModule = z.infer<typeof scheduleModuleSchema>;

/** Esquema Zod para el destino del backup programado: servidor origen o destino. */
export const scheduleTargetSchema = z.enum(["source", "target"]);
/** Indica si el backup programado aplica al servidor origen o al destino. */
export type ScheduleTarget = z.infer<typeof scheduleTargetSchema>;

/** Esquema Zod para el estado de una ejecución de backup programado. */
export const scheduleRunStatusSchema = z.enum(["success", "failed", "running"]);
/** Estado de una ejecución de backup programado. */
export type ScheduleRunStatus = z.infer<typeof scheduleRunStatusSchema>;

/** Esquema Zod para el tipo de activación que disparó la ejecución: manual o programada por cron. */
export const scheduleRunTriggerSchema = z.enum(["manual", "scheduled"]);
/** Tipo de activación que disparó la ejecución: manual o por cron programado. */
export type ScheduleRunTrigger = z.infer<typeof scheduleRunTriggerSchema>;

/** Esquema Zod para un registro individual de ejecución de un backup programado. */
export const scheduleRunSchema = z.object({
  ranAt: z.string().min(1),
  finishedAt: z.string().optional(),
  status: scheduleRunStatusSchema,
  trigger: scheduleRunTriggerSchema.default("scheduled"),
  jobId: z.string().optional(),
  durationMs: z.number().int().nonnegative().optional(),
  errorMessage: z.string().optional(),
});
/** Registro de una ejecución individual de un backup programado. */
export type ScheduleRun = z.infer<typeof scheduleRunSchema>;

/** Esquema Zod para un backup programado completo con configuración, estado y historial. */
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
/** Un backup programado completo con su configuración, estado y historial de ejecuciones. */
export type Schedule = z.infer<typeof scheduleSchema>;

/** Esquema Zod para los datos de entrada al crear un nuevo backup programado. */
export const scheduleInputSchema = z.object({
  name: z.string().min(1).max(100),
  cronExpression: z.string().min(1).max(120),
  timezone: z.string().min(1).max(80),
  module: scheduleModuleSchema.default("all"),
  target: scheduleTargetSchema.default("source"),
  enabled: z.boolean().default(true),
});
/** Datos de entrada para crear un nuevo backup programado. */
export type ScheduleInput = z.infer<typeof scheduleInputSchema>;

/** Esquema Zod para actualizar parcialmente un backup programado (todos los campos opcionales). */
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
/** Campos actualizables de un backup programado (todos opcionales). */
export type SchedulePatch = z.infer<typeof schedulePatchSchema>;

/** Vista resumida de un backup programado sin el historial de ejecuciones. */
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

/** Cantidad máxima de registros de ejecución que se conservan en el historial de un schedule. */
export const HISTORY_LIMIT = 20;
