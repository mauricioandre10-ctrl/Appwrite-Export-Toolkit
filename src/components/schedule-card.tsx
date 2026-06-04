"use client";

import { useCallback, useEffect, useState } from "react";

import { ScheduleStatusBadge } from "./schedule-status-badge";
import { TriggerBadge } from "./trigger-badge";

/** Vista de un schedule programado, incluyendo estado, historial y datos de ejecución en vivo. */
export type ScheduleViewModel = {
  id: string;
  name: string;
  cronExpression: string;
  timezone: string;
  module: string;
  target: string;
  enabled: boolean;
  lastRunAt?: string | undefined;
  lastRunStatus?: string | undefined;
  lastRunTrigger?: string | undefined;
  lastRunJobId?: string | undefined;
  nextRunAt?: string | undefined;
  currentRunJobId?: string | undefined;
  history: Array<{
    ranAt: string;
    finishedAt?: string | undefined;
    status: string;
    trigger?: string | undefined;
    durationMs?: number | undefined;
    errorMessage?: string | undefined;
    jobId?: string | undefined;
  }>;
};

type LiveProgress = {
  percent: number;
  phase: string;
  module: string;
  detail: string;
};

type Props = {
  schedule: ScheduleViewModel;
  onToggle: (enabled: boolean) => void;
  onEdit: () => void;
  onDelete: () => void;
  onRun: (schedule: ScheduleViewModel) => Promise<string | null>;
  busy: boolean;
  toggling: boolean;
};

function formatRelative(value: string | undefined): string {
  if (value === undefined) return "—";
  const date = new Date(value);
  const diffMs = date.getTime() - Date.now();
  const abs = Math.abs(diffMs);
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;

  let amount: number;
  let unit: Intl.RelativeTimeFormatUnit;
  if (abs < hour) {
    amount = Math.round(diffMs / minute);
    unit = "minute";
  } else if (abs < day) {
    amount = Math.round(diffMs / hour);
    unit = "hour";
  } else {
    amount = Math.round(diffMs / day);
    unit = "day";
  }

  try {
    const rtf = new Intl.RelativeTimeFormat("es", { numeric: "auto" });
    return rtf.format(amount, unit);
  } catch {
    return value;
  }
}

function formatAbsolute(value: string | undefined): string {
  if (value === undefined) return "—";
  try {
    return new Intl.DateTimeFormat("es", {
      dateStyle: "short",
      timeStyle: "medium",
    }).format(new Date(value));
  } catch {
    return value;
  }
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remSecs = seconds % 60;
  if (minutes < 60) return `${minutes}m ${remSecs}s`;
  const hours = Math.floor(minutes / 60);
  const remMins = minutes % 60;
  return `${hours}h ${remMins}m`;
}

const PHASE_LABELS: Record<string, { label: string; emoji: string }> = {
  preparando: { label: "Preparando", emoji: "⚙️" },
  initializing: { label: "Inicializando", emoji: "🚀" },
  exporting: { label: "Exportando", emoji: "📦" },
  checksums: { label: "Calculando checksums", emoji: "🔐" },
  loading: { label: "Cargando metadatos", emoji: "📥" },
  importing: { label: "Importando", emoji: "📥" },
  finalizing: { label: "Finalizando", emoji: "✨" },
  restoring: { label: "Restaurando", emoji: "🔄" },
};

function getPhaseInfo(phase: string): { label: string; emoji: string } {
  return PHASE_LABELS[phase] ?? { label: phase || "Procesando", emoji: "⏳" };
}

const MODULE_LABELS: Record<string, { label: string; emoji: string }> = {
  all: { label: "Todos", emoji: "📦" },
  auth: { label: "Auth", emoji: "👥" },
  databases: { label: "Bases", emoji: "🗄️" },
  storage: { label: "Storage", emoji: "💾" },
};

function RunningTimer({ startedAt }: { startedAt: string }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(interval);
  }, []);
  const elapsed = Math.max(0, now - new Date(startedAt).getTime());
  return <span>{formatDuration(elapsed)}</span>;
}

/**
 * Subscribes to a job's SSE stream and reports progress up via callbacks. Isolated as a
 * child component with a `key` on the parent so the entire state (incl. EventSource)
 * is re-created when the jobId changes — no setState inside the effect body.
 */
function LiveProgressReader({
  jobId,
  onProgress,
  onComplete,
  onError,
}: {
  jobId: string;
  onProgress: (p: LiveProgress) => void;
  onComplete: () => void;
  onError: (error: string) => void;
}) {
  useEffect(() => {
    const es = new EventSource(`/api/jobs/${jobId}/stream`);

    es.addEventListener("progress", (e) => {
      try {
        onProgress(JSON.parse((e as MessageEvent).data) as LiveProgress);
      } catch {
        // ignore malformed payload
      }
    });

    es.addEventListener("complete", () => {
      es.close();
      onComplete();
    });

    es.addEventListener("error-event", (e) => {
      try {
        const payload = JSON.parse((e as MessageEvent).data) as { error: string };
        onError(payload.error);
      } catch {
        onError("Error desconocido");
      }
      es.close();
    });

    es.onerror = () => {
      es.close();
    };

    return () => {
      es.close();
    };
  }, [jobId, onProgress, onComplete, onError]);

  return null;
}

/** Tarjeta visual de un schedule con toggle, acciones, progreso en vivo y historial de ejecuciones. */
export function ScheduleCard({ schedule, onToggle, onEdit, onDelete, onRun, busy, toggling }: Props) {
  const mod = MODULE_LABELS[schedule.module] ?? { label: schedule.module, emoji: "📦" };
  const isRunning = schedule.lastRunStatus === "running";
  const liveJobId = schedule.currentRunJobId;
  const isManual = schedule.lastRunTrigger === "manual";
  const lastError = schedule.history[0]?.errorMessage;

  const [liveProgress, setLiveProgress] = useState<LiveProgress | null>(null);
  const [liveError, setLiveError] = useState<string | null>(null);

  const handleLiveProgress = useCallback((p: LiveProgress) => {
    setLiveProgress(p);
    setLiveError(null);
  }, []);

  const handleLiveComplete = useCallback(() => {
    setLiveProgress({ percent: 100, phase: "completed", module: "", detail: "" });
  }, []);

  const handleLiveError = useCallback((error: string) => {
    setLiveError(error);
  }, []);

  const displayPercent = liveProgress?.percent ?? (isRunning ? 0 : 0);
  const displayPhase = liveProgress?.phase ?? (isRunning ? "preparando" : "");
  const phaseInfo = getPhaseInfo(displayPhase);
  const progressColor =
    liveError !== null
      ? "from-red-400 via-red-300 to-red-200"
      : displayPercent >= 100
        ? "from-emerald-400 via-emerald-300 to-emerald-200"
        : isRunning
          ? "from-violet-400 via-fuchsia-300 to-violet-200"
          : "from-violet-400 via-violet-300 to-violet-200";

  return (
    <div
      className={`rounded-2xl border p-5 transition ${
        schedule.enabled
          ? isRunning
            ? "border-violet-300/40 bg-violet-300/[0.04] shadow-lg shadow-violet-900/20"
            : "border-violet-300/20 bg-white/[0.04]"
          : "border-white/10 bg-white/[0.02] opacity-70"
      }`}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="truncate text-lg font-black text-white">{schedule.name}</h3>
            {isRunning ? (
              <span className="inline-flex items-center gap-1.5 rounded-full border border-sky-300/40 bg-sky-300/15 px-2.5 py-1 text-[10px] font-bold text-sky-100">
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-sky-300" />
                En curso
                <TriggerBadge trigger={schedule.lastRunTrigger} />
                <span className="text-sky-300/60">·</span>
                <RunningTimer startedAt={schedule.lastRunAt ?? new Date().toISOString()} />
              </span>
            ) : (
              <>
                <ScheduleStatusBadge status={schedule.lastRunStatus} />
                {schedule.lastRunAt !== undefined ? (
                  <TriggerBadge trigger={schedule.lastRunTrigger} />
                ) : null}
                {schedule.lastRunStatus === "success" && schedule.history[0]?.durationMs !== undefined ? (
                  <span className="inline-flex items-center gap-1 rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[10px] font-bold text-slate-300">
                    ⏱ {formatDuration(schedule.history[0].durationMs!)}
                  </span>
                ) : null}
              </>
            )}
          </div>
          <p className="mt-1 font-mono text-xs text-slate-400">{schedule.cronExpression}</p>
          <p className="mt-0.5 text-[11px] text-slate-500">Timezone: {schedule.timezone}</p>
        </div>

        <label className="inline-flex cursor-pointer items-center gap-2">
          <span className="text-[10px] font-semibold tracking-wider text-slate-400 uppercase">
            {toggling ? "..." : schedule.enabled ? "ON" : "OFF"}
          </span>
          <span className="relative">
            <input
              type="checkbox"
              checked={schedule.enabled}
              onChange={(e) => onToggle(e.target.checked)}
              disabled={toggling || busy || isRunning}
              className="peer sr-only"
            />
            <span className="block h-6 w-11 rounded-full border border-white/15 bg-white/10 transition peer-checked:border-violet-300/60 peer-checked:bg-violet-300/30" />
            <span className="absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white shadow transition peer-checked:translate-x-5 peer-checked:bg-violet-200" />
          </span>
        </label>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="rounded-xl border border-white/10 bg-slate-950/50 p-3">
          <p className="text-[10px] font-semibold tracking-wider text-slate-500 uppercase">Módulo</p>
          <p className="mt-1 text-sm font-bold text-white">
            <span className="mr-1">{mod.emoji}</span>
            {mod.label}
          </p>
        </div>
        <div className="rounded-xl border border-white/10 bg-slate-950/50 p-3">
          <p className="text-[10px] font-semibold tracking-wider text-slate-500 uppercase">Target</p>
          <p className="mt-1 text-sm font-bold text-white">{schedule.target === "source" ? "Origen" : "Destino"}</p>
        </div>
        <div className="rounded-xl border border-white/10 bg-slate-950/50 p-3">
          <p className="text-[10px] font-semibold tracking-wider text-slate-500 uppercase">Última ejecución</p>
          {isRunning ? (
            <>
              <p className="mt-1 text-sm font-bold text-sky-200">En curso</p>
              <p className="text-[10px] text-slate-500">{isManual ? "Manual" : "Automática"}</p>
            </>
          ) : schedule.lastRunAt !== undefined ? (
            <>
              <p className="mt-1 text-sm font-bold text-white">{formatRelative(schedule.lastRunAt)}</p>
              <p className="text-[10px] text-slate-500">{formatAbsolute(schedule.lastRunAt)}</p>
            </>
          ) : (
            <>
              <p className="mt-1 text-sm font-bold text-slate-400">Nunca</p>
              <p className="text-[10px] text-slate-500">Sin ejecuciones</p>
            </>
          )}
        </div>
        <div className="rounded-xl border border-white/10 bg-slate-950/50 p-3">
          <p className="text-[10px] font-semibold tracking-wider text-slate-500 uppercase">Próxima</p>
          <p className="mt-1 text-sm font-bold text-white">{formatRelative(schedule.nextRunAt)}</p>
          <p className="text-[10px] text-slate-500">{formatAbsolute(schedule.nextRunAt)}</p>
        </div>
      </div>

      {isRunning && liveJobId !== undefined ? (
        <LiveProgressReader
          key={liveJobId}
          jobId={liveJobId}
          onProgress={handleLiveProgress}
          onComplete={handleLiveComplete}
          onError={handleLiveError}
        />
      ) : null}

      {isRunning ? (
        <div className="mt-4 rounded-2xl border border-violet-300/30 bg-gradient-to-br from-violet-300/[0.08] to-fuchsia-300/[0.04] p-4">
          <div className="mb-2 flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <span className="text-xl">{phaseInfo.emoji}</span>
              <div>
                <p className="text-sm font-semibold text-white">{phaseInfo.label}</p>
                <p className="text-[11px] text-slate-500">
                  {liveProgress?.module && liveProgress.module !== "all"
                    ? `· ${liveProgress.module}`
                    : liveProgress?.module === "all"
                      ? "· todos los módulos"
                      : ""}
                </p>
              </div>
            </div>
            <p className="text-2xl font-black tabular-nums text-violet-200">
              {displayPercent}
              <span className="text-sm text-violet-200/60">%</span>
            </p>
          </div>
          <div className="relative h-2.5 w-full overflow-hidden rounded-full bg-slate-900/60">
            <div
              className={`absolute inset-y-0 left-0 rounded-full bg-gradient-to-r ${progressColor} transition-all duration-700 ease-out`}
              style={{ width: `${Math.max(2, displayPercent)}%` }}
            >
              <div className="absolute inset-0 animate-pulse bg-white/20" />
            </div>
          </div>
          {liveError !== null ? (
            <p className="mt-2 truncate text-[11px] text-red-300" title={liveError}>
              ⚠ {liveError}
            </p>
          ) : null}
        </div>
      ) : null}

      {!isRunning && lastError !== undefined && schedule.lastRunStatus === "failed" ? (
        <div className="mt-4 flex items-start gap-2 rounded-2xl border border-red-300/30 bg-red-300/10 p-3">
          <div className="grid size-6 shrink-0 place-items-center rounded-full bg-red-400/20 text-xs">⚠</div>
          <div className="min-w-0">
            <p className="text-[11px] font-bold text-red-200">Última ejecución falló</p>
            <p className="mt-0.5 truncate text-[11px] text-red-300/80" title={lastError}>
              {lastError}
            </p>
          </div>
        </div>
      ) : null}

      {schedule.history.length > 0 ? (
        <details className="mt-4" open={schedule.history.length <= 3}>
          <summary className="cursor-pointer text-[11px] font-semibold tracking-wider text-slate-400 uppercase hover:text-slate-200">
            Historial ({schedule.history.length})
          </summary>
          <div className="mt-2 max-h-56 space-y-1 overflow-auto rounded-xl border border-white/10 bg-slate-950/40 p-2">
            {schedule.history.map((run, i) => (
              <div key={i} className="flex flex-wrap items-center gap-2 rounded-lg px-2 py-1.5 font-mono text-[11px] hover:bg-white/[0.03]">
                <ScheduleStatusBadge status={run.status} />
                <TriggerBadge trigger={run.trigger} />
                <span className="text-slate-500">{formatAbsolute(run.ranAt)}</span>
                {run.durationMs !== undefined ? (
                  <span className="text-slate-600">· {formatDuration(run.durationMs)}</span>
                ) : null}
                {run.errorMessage !== undefined ? (
                  <span className="truncate text-red-300/80" title={run.errorMessage}>
                    · {run.errorMessage}
                  </span>
                ) : null}
              </div>
            ))}
          </div>
        </details>
      ) : null}

      <div className="mt-4 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => void onRun(schedule)}
          disabled={isRunDisabled(busy, isRunning)}
          className="inline-flex items-center gap-1.5 rounded-full border border-violet-300/40 bg-violet-300/15 px-3 py-2 text-xs font-bold text-violet-100 transition hover:bg-violet-300/25 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <svg className="h-3 w-3" viewBox="0 0 12 12" fill="currentColor">
            <path d="M3 2v8l7-4-7-4z" />
          </svg>
          {isRunning ? "Ejecutando..." : "Ejecutar ahora"}
        </button>
        <button
          type="button"
          onClick={onEdit}
          disabled={busy || isRunning}
          className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-3 py-2 text-xs font-bold text-white transition hover:bg-white/10 disabled:opacity-50"
        >
          <svg className="h-3 w-3" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M8.5 2.5l1 1-6 6H2.5v-1l6-6z" />
          </svg>
          Editar
        </button>
        <button
          type="button"
          onClick={onDelete}
          disabled={busy || isRunning}
          className="inline-flex items-center gap-1.5 rounded-full border border-red-300/30 bg-red-300/10 px-3 py-2 text-xs font-bold text-red-200 transition hover:bg-red-300/20 disabled:opacity-50"
        >
          <svg className="h-3 w-3" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M2 3h8M4 3V2h4v1M3.5 3v7h5V3" />
          </svg>
          Eliminar
        </button>
      </div>
    </div>
  );
}

function isRunDisabled(busy: boolean, isRunning: boolean): boolean {
  return busy || isRunning;
}
