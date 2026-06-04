"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { ScheduleCard, type ScheduleViewModel } from "./schedule-card";
import { ScheduleFormDialog, type ScheduleFormValues } from "./schedule-form-dialog";

function getCsrfHeaders(): Record<string, string> {
  if (typeof document === "undefined") return {};
  const meta = document.querySelector('meta[name="csrf-token"]');
  const token = meta?.getAttribute("content") ?? "";
  return { "x-csrf-token": token };
}

type ApiSchedule = {
  id: string;
  name: string;
  cronExpression: string;
  timezone: string;
  module: "all" | "auth" | "databases" | "storage";
  target: "source" | "target";
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
  lastRunAt?: string;
  lastRunStatus?: string;
  lastRunTrigger?: string;
  lastRunJobId?: string;
  nextRunAt?: string;
  currentRunJobId?: string;
  history?: Array<{
    ranAt: string;
    finishedAt?: string;
    status: string;
    trigger?: string;
    durationMs?: number;
    errorMessage?: string;
    jobId?: string;
  }>;
};

type Feedback = { tone: "success" | "error"; message: string };

const IDLE_POLL_MS = 10_000;
const ACTIVE_POLL_MS = 2_000;

function toViewModel(s: ApiSchedule): ScheduleViewModel {
  return {
    id: s.id,
    name: s.name,
    cronExpression: s.cronExpression,
    timezone: s.timezone,
    module: s.module,
    target: s.target,
    enabled: s.enabled,
    lastRunAt: s.lastRunAt,
    lastRunStatus: s.lastRunStatus,
    lastRunTrigger: s.lastRunTrigger,
    lastRunJobId: s.lastRunJobId,
    nextRunAt: s.nextRunAt,
    currentRunJobId: s.currentRunJobId,
    history: s.history ?? [],
  };
}

/** Panel de gestión de backups programados: crear, editar, ejecutar y eliminar schedules. */
export function SchedulesPanel() {
  const [schedules, setSchedules] = useState<ScheduleViewModel[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<ScheduleViewModel | null>(null);
  const [busyIds, setBusyIds] = useState<Set<string>>(new Set());
  const [togglingIds, setTogglingIds] = useState<Set<string>>(new Set());
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const feedbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const hasRunning = schedules.some((s) => s.lastRunStatus === "running");

  const loadSchedules = useCallback(async () => {
    try {
      const res = await fetch("/api/schedules", { credentials: "same-origin", cache: "no-store" });
      if (!res.ok) {
        const txt = await res.text();
        throw new Error(`HTTP ${res.status}: ${txt}`);
      }
      const data = (await res.json()) as { schedules: ApiSchedule[] };
      setSchedules(data.schedules.map(toViewModel));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error cargando schedules");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function tick() {
      try {
        const res = await fetch("/api/schedules", { credentials: "same-origin", cache: "no-store" });
        if (cancelled || !res.ok) return;
        const data = (await res.json()) as { schedules: ApiSchedule[] };
        if (cancelled) return;
        setSchedules(data.schedules.map(toViewModel));
        setError(null);
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Error cargando schedules");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void tick();
    const interval = setInterval(() => void tick(), hasRunning ? ACTIVE_POLL_MS : IDLE_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [hasRunning]);

  useEffect(() => {
    return () => {
      if (feedbackTimerRef.current !== null) clearTimeout(feedbackTimerRef.current);
    };
  }, []);

  function showFeedback(tone: "success" | "error", message: string, autoDismissMs = 6000) {
    setFeedback({ tone, message });
    if (feedbackTimerRef.current !== null) clearTimeout(feedbackTimerRef.current);
    feedbackTimerRef.current = setTimeout(() => setFeedback(null), autoDismissMs);
  }

  function setBusy(id: string, busy: boolean) {
    setBusyIds((prev) => {
      const next = new Set(prev);
      if (busy) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  function setToggling(id: string, busy: boolean) {
    setTogglingIds((prev) => {
      const next = new Set(prev);
      if (busy) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  async function handleCreate(values: ScheduleFormValues) {
    const res = await fetch("/api/schedules", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...getCsrfHeaders() },
      credentials: "same-origin",
      body: JSON.stringify(values),
    });
    if (!res.ok) {
      const txt = await res.text();
      throw new Error(`HTTP ${res.status}: ${txt}`);
    }
    setDialogOpen(false);
    setEditing(null);
    showFeedback("success", `Schedule "${values.name}" creado`, 4000);
    await loadSchedules();
  }

  async function handleUpdate(values: ScheduleFormValues) {
    if (editing === null) return;
    const res = await fetch(`/api/schedules/${encodeURIComponent(editing.id)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", ...getCsrfHeaders() },
      credentials: "same-origin",
      body: JSON.stringify(values),
    });
    if (!res.ok) {
      const txt = await res.text();
      throw new Error(`HTTP ${res.status}: ${txt}`);
    }
    setDialogOpen(false);
    setEditing(null);
    showFeedback("success", `Schedule "${values.name}" actualizado`, 4000);
    await loadSchedules();
  }

  async function handleToggle(schedule: ScheduleViewModel, enabled: boolean) {
    setToggling(schedule.id, true);
    try {
      const res = await fetch(`/api/schedules/${encodeURIComponent(schedule.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", ...getCsrfHeaders() },
        credentials: "same-origin",
        body: JSON.stringify({ enabled }),
      });
      if (!res.ok) {
        const txt = await res.text();
        throw new Error(`HTTP ${res.status}: ${txt}`);
      }
      showFeedback("success", enabled ? `Schedule "${schedule.name}" activado` : `Schedule "${schedule.name}" desactivado`, 3000);
      await loadSchedules();
    } catch (err) {
      showFeedback("error", err instanceof Error ? err.message : "Error al cambiar estado", 8000);
    } finally {
      setToggling(schedule.id, false);
    }
  }

  async function handleDelete(schedule: ScheduleViewModel) {
    if (!window.confirm(`¿Eliminar schedule "${schedule.name}"? Esta acción no se puede deshacer.`)) {
      return;
    }
    setBusy(schedule.id, true);
    try {
      const res = await fetch(`/api/schedules/${encodeURIComponent(schedule.id)}`, {
        method: "DELETE",
        headers: getCsrfHeaders(),
        credentials: "same-origin",
      });
      if (!res.ok) {
        const txt = await res.text();
        throw new Error(`HTTP ${res.status}: ${txt}`);
      }
      showFeedback("success", `Schedule "${schedule.name}" eliminado`, 4000);
      await loadSchedules();
    } catch (err) {
      showFeedback("error", err instanceof Error ? err.message : "Error al eliminar", 8000);
    } finally {
      setBusy(schedule.id, false);
    }
  }

  /**
   * Triggers a manual run. Returns the new jobId if the server accepted it, otherwise null.
   * The card subscribes to SSE on its own using the jobId from `currentRunJobId` (set by polling
   * once the run is registered). This function additionally subscribes once to surface the final
   * status in the feedback banner.
   */
  async function handleRun(schedule: ScheduleViewModel): Promise<string | null> {
    setBusy(schedule.id, true);
    let triggeredJobId: string | null = null;
    try {
      const res = await fetch(`/api/schedules/${encodeURIComponent(schedule.id)}/run`, {
        method: "POST",
        headers: getCsrfHeaders(),
        credentials: "same-origin",
      });
      if (res.status === 409) {
        showFeedback("error", "El schedule ya está en ejecución", 5000);
        return null;
      }
      if (!res.ok) {
        const txt = await res.text();
        throw new Error(`HTTP ${res.status}: ${txt}`);
      }
      const data = (await res.json()) as { jobId?: string };
      triggeredJobId = data.jobId ?? null;
      showFeedback("success", `Ejecutando "${schedule.name}"...`, 4000);
      await loadSchedules();

      if (triggeredJobId !== null) {
        watchRunForFeedback(schedule, triggeredJobId);
      }
      return triggeredJobId;
    } catch (err) {
      showFeedback("error", err instanceof Error ? err.message : "Error al ejecutar", 8000);
      return null;
    } finally {
      setBusy(schedule.id, false);
    }
  }

  /**
   * Subscribes once to a job's SSE stream to update the feedback banner with the final result.
   */
  function watchRunForFeedback(schedule: ScheduleViewModel, jobId: string) {
    const es = new EventSource(`/api/jobs/${jobId}/stream`);

    es.addEventListener("complete", (e) => {
      try {
        const data = JSON.parse((e as MessageEvent).data) as { status?: string };
        if (data.status === "failed") {
          showFeedback("error", `"${schedule.name}" falló al ejecutarse`, 8000);
        } else {
          showFeedback("success", `"${schedule.name}" completado`, 5000);
        }
      } catch {
        showFeedback("success", `"${schedule.name}" completado`, 5000);
      }
      es.close();
      void loadSchedules();
    });

    es.addEventListener("error-event", (e) => {
      try {
        const data = JSON.parse((e as MessageEvent).data) as { error?: string };
        showFeedback("error", `"${schedule.name}" falló: ${data.error ?? "error desconocido"}`, 10_000);
      } catch {
        showFeedback("error", `"${schedule.name}" falló al ejecutarse`, 8000);
      }
      es.close();
      void loadSchedules();
    });

    // Hard timeout fallback in case the SSE never closes.
    setTimeout(() => {
      es.close();
      void loadSchedules();
    }, 10 * 60 * 1000);
  }

  function openCreate() {
    setEditing(null);
    setDialogOpen(true);
  }

  function openEdit(schedule: ScheduleViewModel) {
    setEditing(schedule);
    setDialogOpen(true);
  }

  const editingValues: ScheduleFormValues | undefined =
    editing !== null
      ? {
          name: editing.name,
          cronExpression: editing.cronExpression,
          timezone: editing.timezone,
          module: editing.module as ScheduleFormValues["module"],
          target: editing.target as ScheduleFormValues["target"],
          enabled: editing.enabled,
        }
      : undefined;

  return (
    <section className="py-6">
      <div className="rounded-[2rem] border border-white/10 bg-slate-950/50 p-6 shadow-2xl shadow-black/20">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-sm font-semibold tracking-[0.24em] text-violet-200 uppercase">Schedules</p>
            <h1 className="mt-3 text-4xl font-black tracking-tight text-white sm:text-5xl">Backups automáticos</h1>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-300 sm:text-base">
              Programa exports recurrentes. Los schedules se ejecutan dentro del servidor Next.js y se
              persisten en <code className="rounded bg-slate-800/60 px-1.5 py-0.5 font-mono text-xs">BACKUP_OUTPUT_DIR/.schedules</code>.
            </p>
          </div>
          <button
            type="button"
            onClick={openCreate}
            className="inline-flex items-center gap-2 self-start rounded-2xl border border-violet-300/40 bg-violet-300/15 px-5 py-3 text-sm font-bold text-violet-100 transition hover:bg-violet-300/25"
          >
            <span className="text-lg">+</span>
            Nuevo schedule
          </button>
        </div>

        <div className="mt-6 grid gap-3 sm:grid-cols-3">
          <Stat label="Schedules" value={String(schedules.length)} tone="violet" />
          <Stat label="Activos" value={String(schedules.filter((s) => s.enabled).length)} tone="emerald" />
          <Stat
            label={hasRunning ? "Ejecutando ahora" : "Última ejecución"}
            value={(() => {
              const running = schedules.find((s) => s.lastRunStatus === "running");
              if (running) return running.name;
              const withRun = schedules
                .filter((s) => s.lastRunAt !== undefined)
                .sort((a, b) => (b.lastRunAt ?? "").localeCompare(a.lastRunAt ?? ""))[0];
              if (!withRun?.lastRunAt) return "nunca";
              return formatRelativeShort(withRun.lastRunAt);
            })()}
            tone={hasRunning ? "sky" : "slate"}
          />
        </div>
      </div>

      {feedback !== null ? (
        <div
          className={`mt-5 rounded-2xl border p-4 ${
            feedback.tone === "success"
              ? "border-emerald-300/20 bg-emerald-300/10 text-emerald-100"
              : "border-red-300/20 bg-red-300/10 text-red-100"
          }`}
        >
          <p className="text-sm font-bold">{feedback.message}</p>
        </div>
      ) : null}

      {error !== null ? (
        <div className="mt-5 rounded-2xl border border-red-300/30 bg-red-300/10 p-4 text-red-200">
          <p className="text-sm font-bold">Error cargando schedules</p>
          <p className="mt-1 text-xs">{error}</p>
        </div>
      ) : null}

      {loading ? (
        <div className="mt-6 flex items-center justify-center rounded-2xl border border-white/10 bg-slate-950/50 p-12 text-slate-400">
          <div className="h-5 w-5 animate-spin rounded-full border-2 border-violet-300 border-t-transparent" />
          <span className="ml-3 text-sm">Cargando schedules...</span>
        </div>
      ) : schedules.length === 0 ? (
        <div className="mt-6 rounded-[2rem] border border-dashed border-white/15 bg-white/[0.03] p-12 text-center">
          <div className="mx-auto grid size-16 place-items-center rounded-full bg-violet-300/10 text-3xl">⏰</div>
          <h2 className="mt-4 text-2xl font-black text-white">Sin schedules</h2>
          <p className="mt-2 text-sm text-slate-400">Crea tu primer schedule para automatizar los exports.</p>
          <button
            type="button"
            onClick={openCreate}
            className="mt-5 inline-flex items-center gap-2 rounded-2xl border border-violet-300/40 bg-violet-300/15 px-5 py-3 text-sm font-bold text-violet-100 transition hover:bg-violet-300/25"
          >
            <span>+</span> Crear primer schedule
          </button>
        </div>
      ) : (
        <div className="mt-6 grid gap-4">
          {schedules.map((s) => (
            <ScheduleCard
              key={s.id}
              schedule={s}
              busy={busyIds.has(s.id)}
              toggling={togglingIds.has(s.id)}
              onToggle={(enabled) => void handleToggle(s, enabled)}
              onEdit={() => openEdit(s)}
              onDelete={() => void handleDelete(s)}
              onRun={handleRun}
            />
          ))}
        </div>
      )}

      <ScheduleFormDialog
        // Re-mount whenever the editing target changes so the dialog's internal state
        // (values, submitting, error) re-initializes from `initial` on each open.
        // Without this, switching between create / edit-A / edit-B keeps stale data.
        key={editing?.id ?? "new"}
        open={dialogOpen}
        initial={editingValues}
        mode={editing === null ? "create" : "edit"}
        onClose={() => {
          setDialogOpen(false);
          setEditing(null);
        }}
        onSubmit={async (values) => {
          if (editing === null) {
            await handleCreate(values);
          } else {
            await handleUpdate(values);
          }
        }}
      />
    </section>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone: "violet" | "emerald" | "slate" | "sky" }) {
  const toneClass = {
    violet: "border-violet-300/20 bg-violet-300/10 text-violet-100",
    emerald: "border-emerald-300/20 bg-emerald-300/10 text-emerald-100",
    slate: "border-white/10 bg-white/[0.04] text-slate-100",
    sky: "border-sky-300/20 bg-sky-300/10 text-sky-100",
  }[tone];

  return (
    <div className={`rounded-2xl border p-4 ${toneClass}`}>
      <p className="truncate text-xl font-black">{value}</p>
      <p className="mt-1 text-[10px] tracking-[0.2em] opacity-70 uppercase">{label}</p>
    </div>
  );
}

function formatRelativeShort(value: string): string {
  const diffMs = Date.now() - new Date(value).getTime();
  const abs = Math.abs(diffMs);
  const m = 60_000;
  const h = 60 * m;
  const d = 24 * h;
  if (abs < m) return "hace segundos";
  if (abs < h) return `hace ${Math.floor(abs / m)} min`;
  if (abs < d) return `hace ${Math.floor(abs / h)} h`;
  return `hace ${Math.floor(abs / d)} d`;
}
