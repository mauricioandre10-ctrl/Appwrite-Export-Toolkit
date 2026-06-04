"use client";

import { useState, useRef } from "react";

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
  exporting: { label: "Exportando", emoji: "📦" },
  checksums: { label: "Calculando checksums", emoji: "🔐" },
  loading: { label: "Cargando metadatos", emoji: "📥" },
  importing: { label: "Importando", emoji: "📥" },
  finalizing: { label: "Finalizando", emoji: "✨" },
};

function getPhaseInfo(phase: string): PhaseInfo {
  return PHASE_LABELS[phase] ?? { label: phase, emoji: "⏳" };
}

export function ExportPanel({ configError }: { configError: string | null }) {
  const modules = ["all", "auth", "databases", "storage"];
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState<JobProgress | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [activeModule, setActiveModule] = useState<string | null>(null);
  const esRef = useRef<EventSource | null>(null);

  async function startExport(module: string) {
    if (configError !== null || loading) return;

    if (esRef.current) {
      esRef.current.close();
      esRef.current = null;
    }

    setLoading(true);
    setActiveModule(module);
    setProgress(null);
    setErrorMsg(null);

    try {
      const csrfMeta = document.querySelector('meta[name="csrf-token"]');
      const csrfToken = csrfMeta?.getAttribute("content") ?? "";

      const res = await fetch("/api/export", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-csrf-token": csrfToken,
        },
        body: JSON.stringify({ module }),
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
        // Don't close - let EventSource auto-reconnect for transient errors.
        // If the job is already complete, the server will close the connection.
        // Show error only after a delay to allow reconnection.
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
          <p className="text-sm font-semibold tracking-[0.24em] text-emerald-200 uppercase">Acciones</p>
          <h2 className="mt-3 text-2xl font-black text-white">Nuevo export</h2>
        </div>
        {loading && (
          <div className="flex items-center gap-2 rounded-full border border-emerald-300/30 bg-emerald-300/10 px-3 py-1.5 text-xs font-bold text-emerald-200">
            <div className="h-2 w-2 animate-pulse rounded-full bg-emerald-400" />
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
        Cada accion escribe en <code className="rounded bg-slate-800/60 px-1.5 py-0.5 font-mono text-xs">BACKUP_OUTPUT_DIR</code> y genera manifest, checksums y logs.
      </p>

      <div className="mt-6 grid grid-cols-2 gap-3">
        {modules.map((m) => {
          const isActive = loading && activeModule === m;

          return (
            <button
              key={m}
              type="button"
              data-module={m}
              onClick={() => startExport(m)}
              disabled={configError !== null || loading}
              className={`group relative h-16 w-full overflow-hidden rounded-2xl border px-4 text-sm font-bold transition ${
                isActive
                  ? "border-emerald-300/60 bg-emerald-300/15 text-emerald-200"
                  : "border-white/10 bg-slate-950/70 text-white hover:border-emerald-300/50 hover:bg-emerald-300/10"
              } disabled:cursor-not-allowed disabled:opacity-50`}
            >
              <span className="flex items-center justify-center gap-2">
                {m === "all" && (
                  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="size-5">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M20.25 7.5l-.625 10.632a2.25 2.25 0 01-2.247 2.118H6.622a2.25 2.25 0 01-2.247-2.118L3.75 7.5M10 11.25h4M3.375 7.5h17.25c.621 0 1.125-.504 1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125H3.375c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125z" />
                  </svg>
                )}
                {m === "auth" && (
                  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="size-5">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z" />
                  </svg>
                )}
                {m === "databases" && (
                  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="size-5">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M20.25 6.375c0 2.278-3.694 4.125-8.25 4.125S3.75 8.653 3.75 6.375m16.5 0c0-2.278-3.694-4.125-8.25-4.125S3.75 4.097 3.75 6.375m16.5 0v11.25c0 2.278-3.694 4.125-8.25 4.125s-8.25-1.847-8.25-4.125V6.375m16.5 0v3.75m-16.5-3.75v3.75m16.5 0v3.75C20.25 16.153 16.556 18 12 18s-8.25-1.847-8.25-4.125v-3.75m16.5 0c0 2.278-3.694 4.125-8.25 4.125s-8.25-1.847-8.25-4.125" />
                  </svg>
                )}
                {m === "storage" && (
                  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="size-5">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 12.75V12A2.25 2.25 0 014.5 9.75h15A2.25 2.25 0 0121.75 12v.75m-8.69-6.44l-2.12-2.12a1.5 1.5 0 00-1.061-.44H4.5A2.25 2.25 0 002.25 6v12a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9a2.25 2.25 0 00-2.25-2.25h-5.379a1.5 1.5 0 01-1.06-.44z" />
                  </svg>
                )}
                <span className="capitalize">
                  {m === "all" ? "Todo" : m === "databases" ? "Bases" : m}
                </span>
              </span>
              {isActive && (
                <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-emerald-400/50">
                  <div className="h-full origin-left animate-pulse bg-emerald-400" style={{ width: `${progress?.percent ?? 0}%` }} />
                </div>
              )}
            </button>
          );
        })}
      </div>

      {(loading || progress) && !isFailed && (
        <div className="mt-5 rounded-2xl border border-emerald-300/20 bg-gradient-to-br from-emerald-300/[0.08] to-cyan-300/[0.04] p-4">
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
              <p className="text-2xl font-black tabular-nums text-emerald-300">
                {progress?.percent ?? 0}
                <span className="text-sm text-emerald-300/60">%</span>
              </p>
            </div>
          </div>
          <div className="relative h-2.5 w-full overflow-hidden rounded-full bg-slate-900/60">
            <div
              className="absolute inset-y-0 left-0 rounded-full bg-gradient-to-r from-emerald-400 via-cyan-300 to-emerald-300 transition-all duration-700 ease-out"
              style={{ width: `${progress?.percent ?? 0}%` }}
            >
              <div className="absolute inset-0 animate-pulse bg-white/20" />
            </div>
          </div>
          {progress && progress.percent > 0 && progress.percent < 100 && (
            <div className="mt-3 flex items-center gap-1.5 text-[11px] text-slate-500">
              <div className="h-1 w-1 animate-pulse rounded-full bg-emerald-400" />
              <span>Espera unos segundos, no cierres esta pestana</span>
            </div>
          )}
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
            <p className="text-sm font-bold text-red-200">Export fallido</p>
            <p className="mt-0.5 text-xs text-red-300/80">{errorMsg}</p>
          </div>
        </div>
      )}
    </div>
  );
}
