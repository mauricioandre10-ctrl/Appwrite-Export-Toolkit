"use client";

import { useState } from "react";

import { ScheduleCronInput } from "./schedule-cron-input";

export type ScheduleFormValues = {
  name: string;
  cronExpression: string;
  timezone: string;
  module: "all" | "auth" | "databases" | "storage";
  target: "source" | "target";
  enabled: boolean;
};

const MODULES: Array<{ value: ScheduleFormValues["module"]; label: string }> = [
  { value: "all", label: "Todos los módulos" },
  { value: "auth", label: "Solo Auth (usuarios)" },
  { value: "databases", label: "Solo Bases de datos" },
  { value: "storage", label: "Solo Storage" },
];

const TARGETS: Array<{ value: ScheduleFormValues["target"]; label: string; hint: string; detail: string }> = [
  {
    value: "source",
    label: "Source (origen)",
    hint: "Recomendado para backups programados",
    detail: "Usa las variables APPWRITE_ENDPOINT, APPWRITE_PROJECT_ID y APPWRITE_API_KEY del .env. Es el proyecto del que quieres sacar backups.",
  },
  {
    value: "target",
    label: "Target (destino)",
    hint: "Requiere APPWRITE_TARGET_* configurado",
    detail: "Usa las variables APPWRITE_TARGET_ENDPOINT, APPWRITE_TARGET_PROJECT_ID y APPWRITE_TARGET_API_KEY. Esto programa exports de la instancia destino, normalmente la copia restaurada. Solo útil si quieres monitorear/copiar el destino periódicamente.",
  },
];

const DEFAULT_TIMEZONES = [
  "UTC",
  "Europe/Madrid",
  "Europe/London",
  "America/New_York",
  "America/Los_Angeles",
  "America/Mexico_City",
  "America/Bogota",
  "America/Buenos_Aires",
  "Asia/Tokyo",
];

type Props = {
  open: boolean;
  initial?: ScheduleFormValues | undefined;
  onClose: () => void;
  onSubmit: (values: ScheduleFormValues) => Promise<void>;
  mode: "create" | "edit";
};

const DEFAULTS: ScheduleFormValues = {
  name: "",
  cronExpression: "0 2 * * *",
  timezone: "Europe/Madrid",
  module: "all",
  target: "source",
  enabled: true,
};

export function ScheduleFormDialog({ open, initial, onClose, onSubmit, mode }: Props) {
  const [values, setValues] = useState<ScheduleFormValues>(initial ?? DEFAULTS);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!open) return null;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await onSubmit(values);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error desconocido");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-[2rem] border border-violet-300/30 bg-slate-950 p-6 shadow-2xl shadow-violet-900/30"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3">
          <div className="grid size-10 place-items-center rounded-full bg-violet-400/20 text-lg">⏰</div>
          <div>
            <p className="text-sm font-semibold tracking-[0.24em] text-violet-200 uppercase">
              {mode === "create" ? "Nuevo schedule" : "Editar schedule"}
            </p>
            <p className="text-xs text-slate-400">Configura la programación y el módulo a respaldar</p>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="mt-6 space-y-5">
          <label className="block">
            <span className="text-xs font-semibold tracking-wider text-slate-400 uppercase">Nombre</span>
            <input
              type="text"
              required
              maxLength={100}
              value={values.name}
              onChange={(e) => setValues({ ...values, name: e.target.value })}
              placeholder="Backup nocturno"
              className="mt-1.5 w-full rounded-2xl border border-white/10 bg-slate-950/70 px-4 py-3 text-white outline-none transition focus:border-violet-300/60"
            />
          </label>

          <div>
            <p className="text-xs font-semibold tracking-wider text-slate-400 uppercase">Programación</p>
            <div className="mt-1.5">
              <ScheduleCronInput
                value={values.cronExpression}
                onChange={(cronExpression) => setValues({ ...values, cronExpression })}
              />
            </div>
          </div>

          <label className="block">
            <span className="text-xs font-semibold tracking-wider text-slate-400 uppercase">Timezone (IANA)</span>
            <input
              list="tz-list"
              type="text"
              required
              value={values.timezone}
              onChange={(e) => setValues({ ...values, timezone: e.target.value })}
              placeholder="Europe/Madrid"
              className="mt-1.5 w-full rounded-2xl border border-white/10 bg-slate-950/70 px-4 py-3 text-white outline-none transition focus:border-violet-300/60"
            />
            <datalist id="tz-list">
              {DEFAULT_TIMEZONES.map((tz) => (
                <option key={tz} value={tz} />
              ))}
            </datalist>
          </label>

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block">
              <span className="text-xs font-semibold tracking-wider text-slate-400 uppercase">Módulo</span>
              <select
                value={values.module}
                onChange={(e) => setValues({ ...values, module: e.target.value as ScheduleFormValues["module"] })}
                className="mt-1.5 w-full rounded-2xl border border-white/10 bg-slate-950/70 px-4 py-3 text-white outline-none transition focus:border-violet-300/60"
              >
                {MODULES.map((m) => (
                  <option key={m.value} value={m.value}>
                    {m.label}
                  </option>
                ))}
              </select>
            </label>

            <label className="block">
              <span className="text-xs font-semibold tracking-wider text-slate-400 uppercase">Target</span>
              <select
                value={values.target}
                onChange={(e) => setValues({ ...values, target: e.target.value as ScheduleFormValues["target"] })}
                className="mt-1.5 w-full rounded-2xl border border-white/10 bg-slate-950/70 px-4 py-3 text-white outline-none transition focus:border-violet-300/60"
              >
                {TARGETS.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </select>
              <span className="mt-1 block text-[11px] text-slate-500">{TARGETS.find((t) => t.value === values.target)?.hint}</span>
              <p className="mt-2 rounded-xl border border-white/10 bg-slate-950/50 p-2.5 text-[11px] leading-relaxed text-slate-400">
                {TARGETS.find((t) => t.value === values.target)?.detail}
              </p>
            </label>
          </div>

          <label className="flex items-center gap-3">
            <input
              type="checkbox"
              checked={values.enabled}
              onChange={(e) => setValues({ ...values, enabled: e.target.checked })}
              className="size-5 rounded border-white/20 bg-slate-950 text-violet-500 focus:ring-violet-500"
            />
            <div>
              <p className="text-sm font-semibold text-white">Habilitado</p>
              <p className="text-[11px] text-slate-500">Si está desactivado, el schedule no se ejecutará automáticamente</p>
            </div>
          </label>

          {error !== null ? (
            <div className="rounded-2xl border border-red-300/30 bg-red-300/10 p-3 text-sm text-red-200">
              {error}
            </div>
          ) : null}

          <div className="flex flex-col gap-3 sm:flex-row">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 rounded-2xl border border-white/10 bg-white/5 px-5 py-3 text-sm font-bold text-white transition hover:bg-white/10"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={submitting || values.name.trim().length === 0}
              className="flex-1 rounded-2xl border border-violet-300/40 bg-violet-400/20 px-5 py-3 text-sm font-bold text-violet-100 transition hover:bg-violet-400/30 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {submitting ? "Guardando..." : mode === "create" ? "Crear schedule" : "Guardar cambios"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
