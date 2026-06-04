"use client";

import { useState, useRef } from "react";

import type { BackupSummary } from "@/server/backups/catalog";

type JobProgress = {
  jobId: string;
  percent: number;
  phase: string;
  module: string;
  status: string;
};

type PhaseInfo = {
  label: string;
  emoji: string;
};

const PHASE_LABELS: Record<string, PhaseInfo> = {
  preparando: { label: "Preparando", emoji: "⚙️" },
  initializing: { label: "Inicializando", emoji: "🚀" },
  loading: { label: "Cargando metadatos", emoji: "📥" },
  importing: { label: "Importando", emoji: "📥" },
  finalizing: { label: "Finalizando", emoji: "✨" },
  restoring: { label: "Restaurando", emoji: "🔄" },
};

function getPhaseInfo(phase: string): PhaseInfo {
  return PHASE_LABELS[phase] ?? { label: phase, emoji: "⏳" };
}

function formatDate(value: string): string {
  try {
    return new Intl.DateTimeFormat("es", {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: "UTC",
    }).format(new Date(value));
  } catch {
    return value;
  }
}

export function ImportPanel({
  backups,
  configError,
}: {
  backups: BackupSummary[];
  configError: string | null;
}) {
  const modules = ["all", "auth", "databases", "storage"];
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState<JobProgress | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [selectedBackup, setSelectedBackup] = useState("");
  const [selectedModule, setSelectedModule] = useState("all");
  const esRef = useRef<EventSource | null>(null);

  async function handleImport(e: React.FormEvent) {
    e.preventDefault();
    if (configError !== null || loading || !selectedBackup) return;

    if (esRef.current) {
      esRef.current.close();
      esRef.current = null;
    }

    setLoading(true);
    setProgress(null);
    setErrorMsg(null);

    try {
      const csrfMeta = document.querySelector('meta[name="csrf-token"]');
      const csrfToken = csrfMeta?.getAttribute("content") ?? "";

      const res = await fetch("/api/import", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-csrf-token": csrfToken,
        },
        body: JSON.stringify({ backupId: selectedBackup, module: selectedModule }),
        credentials: "same-origin",
      });

      if (!res.ok) {
        const txt = await res.text();
        throw new Error(`HTTP ${res.status}: ${txt}`);
      }

      const data = (await res.json()) as { jobId: string };

      const es = new EventSource(`/api/jobs/${data.jobId}/stream`);
      esRef.current = es;

      es.addEventListener("progress", (e) => {
        const msg = e as MessageEvent;
        const p = JSON.parse(msg.data) as JobProgress;
        setProgress(p);
      });

      es.addEventListener("complete", (e) => {
        const msg = e as MessageEvent;
        const p = JSON.parse(msg.data) as { redirectUrl: string };
        es.close();
        esRef.current = null;
        setLoading(false);
        window.location.href = p.redirectUrl;
      });

      es.addEventListener("error-event", (e) => {
        const msg = e as MessageEvent;
        const p = JSON.parse(msg.data) as { error: string };
        es.close();
        esRef.current = null;
        setLoading(false);
        setErrorMsg(p.error);
      });

      es.onerror = () => {
        if (!esRef.current) return;
        setTimeout(() => {
          if (esRef.current === es && loading) {
            es.close();
            esRef.current = null;
            setLoading(false);
            setErrorMsg("Conexión perdida con el servidor");
          }
        }, 5000);
      };
    } catch (err) {
      setLoading(false);
      setErrorMsg(err instanceof Error ? err.message : "Unknown error");
    }
  }

  const isFailed = errorMsg !== null;
  const isComplete = progress?.status === "completed";

  return (
    <div className="rounded-[2rem] border border-white/10 bg-white/[0.07] p-6 shadow-2xl shadow-black/30 backdrop-blur-xl">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-semibold tracking-[0.24em] text-sky-200 uppercase">Restore</p>
          <h2 className="mt-3 text-2xl font-black text-white">Importar backup</h2>
        </div>
        {loading && (
          <div className="flex items-center gap-2 rounded-full border border-sky-300/30 bg-sky-300/10 px-3 py-1.5 text-xs font-bold text-sky-200">
            <div className="h-2 w-2 animate-pulse rounded-full bg-sky-400" />
            En curso
          </div>
        )}
        {isComplete && !loading && (
          <div className="flex items-center gap-2 rounded-full border border-emerald-300/30 bg-emerald-300/20 px-3 py-1.5 text-xs font-bold text-emerald-200">
            <svg className="h-3 w-3" viewBox="0 0 12 12" fill="none">
              <path d="M2 6l3 3 5-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            Listo
          </div>
        )}
      </div>

      <p className="mt-2 text-sm leading-6 text-slate-300">
        Selecciona el backup y los modulos. Orden: auth → databases → storage.
      </p>

      <form onSubmit={handleImport} className="mt-6 space-y-4">
        <label className="block">
          <span className="text-xs font-semibold tracking-wider text-slate-400 uppercase">Backup</span>
          <select
            value={selectedBackup}
            onChange={(e) => setSelectedBackup(e.target.value)}
            className="mt-1.5 w-full rounded-2xl border border-white/10 bg-slate-950/70 px-4 py-3 text-white outline-none transition focus:border-sky-300/60 disabled:opacity-50"
            required
            disabled={loading}
          >
            <option value="">Seleccionar backup...</option>
            {backups.map((b) => (
              <option key={b.backupId} value={b.backupId}>
                {b.backupId} — {formatDate(b.exportedAt)}
              </option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className="text-xs font-semibold tracking-wider text-slate-400 uppercase">Modulos</span>
          <select
            value={selectedModule}
            onChange={(e) => setSelectedModule(e.target.value)}
            className="mt-1.5 w-full rounded-2xl border border-white/10 bg-slate-950/70 px-4 py-3 text-white outline-none transition focus:border-sky-300/60 disabled:opacity-50"
            disabled={loading}
          >
            {modules.map((m) => (
              <option key={m} value={m}>
                {m === "all" ? "Todos (orden automático)" : m}
              </option>
            ))}
          </select>
        </label>

        <button
          type="submit"
          disabled={configError !== null || loading || !selectedBackup}
          className="group relative h-14 w-full overflow-hidden rounded-2xl border border-white/10 bg-gradient-to-r from-sky-300/20 to-cyan-300/20 px-4 text-sm font-bold text-white transition hover:border-sky-300/60 hover:from-sky-300/30 hover:to-cyan-300/30 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <span className={`flex items-center justify-center gap-2 transition ${loading ? "opacity-0" : ""}`}>
            <span>📥</span>
            <span>Importar backup</span>
          </span>
          {loading && (
            <span className="absolute inset-0 flex items-center justify-center gap-2">
              <div className="h-4 w-4 animate-spin rounded-full border-2 border-sky-300 border-t-transparent" />
              <span className="text-sky-200">Importando...</span>
            </span>
          )}
        </button>
      </form>

      {(loading || progress) && !isFailed && (
        <div className="mt-5 rounded-2xl border border-sky-300/20 bg-gradient-to-br from-sky-300/[0.08] to-cyan-300/[0.04] p-4">
          <div className="mb-3 flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <span className="text-xl">{getPhaseInfo(progress?.phase ?? "preparando").emoji}</span>
              <div>
                <p className="text-sm font-semibold text-white">
                  {getPhaseInfo(progress?.phase ?? "preparando").label}
                  {progress?.module && progress.module !== "all" && (
                    <span className="ml-1.5 text-slate-400">· {progress.module}</span>
                  )}
                  {progress?.module === "all" && (
                    <span className="ml-1.5 text-slate-400">· todos los módulos</span>
                  )}
                </p>
                <p className="text-[11px] text-slate-500">
                  {progress?.percent ?? 0}% completado
                </p>
              </div>
            </div>
            <div className="text-right">
              <p className="text-2xl font-black tabular-nums text-sky-300">
                {progress?.percent ?? 0}
                <span className="text-sm text-sky-300/60">%</span>
              </p>
            </div>
          </div>
          <div className="relative h-2.5 w-full overflow-hidden rounded-full bg-slate-900/60">
            <div
              className="absolute inset-y-0 left-0 rounded-full bg-gradient-to-r from-sky-400 via-cyan-300 to-sky-300 transition-all duration-700 ease-out"
              style={{ width: `${progress?.percent ?? 0}%` }}
            >
              <div className="absolute inset-0 animate-pulse bg-white/20" />
            </div>
          </div>
        </div>
      )}

      {isFailed && (
        <div className="mt-4 flex items-start gap-3 rounded-2xl border border-red-300/30 bg-red-300/10 p-4">
          <div className="grid size-8 shrink-0 place-items-center rounded-full bg-red-400/20">
            <svg className="h-4 w-4 text-red-300" viewBox="0 0 16 16" fill="none">
              <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </div>
          <div>
            <p className="text-sm font-bold text-red-200">Import fallido</p>
            <p className="mt-0.5 text-xs text-red-300/80">{errorMsg}</p>
          </div>
        </div>
      )}
    </div>
  );
}
