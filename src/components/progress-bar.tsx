"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";

type JobProgress = {
  jobId: string;
  type: "import" | "export";
  status: "pending" | "running" | "completed" | "failed";
  percent: number;
  phase: string;
  module: string;
  detail: string;
  startedAt: string;
  finishedAt: string;
  result?: unknown;
  error?: string | undefined;
};

export function JobProgressContainer({ jobId }: { jobId: string }) {
  const router = useRouter();

  const handleComplete = useCallback(
    (progress: JobProgress) => {
      if (progress.type === "import") {
        router.push(`/?imported=${encodeURIComponent(progress.jobId)}&importStatus=${progress.status}&tab=import`);
      } else {
        router.push(`/?exported=${encodeURIComponent(progress.jobId)}&tab=export`);
      }
    },
    [router],
  );

  return <JobProgressBar jobId={jobId} onComplete={handleComplete} />;
}

function JobProgressBar({
  jobId,
  onComplete,
}: {
  jobId: string;
  onComplete?: (progress: JobProgress) => void;
}) {
  const [progress, setProgress] = useState<JobProgress | null>(null);
  const completedRef = useRef(false);
  const onCompleteRef = useRef(onComplete);

  useEffect(() => {
    onCompleteRef.current = onComplete;
  });

  useEffect(() => {
    if (!jobId) return;
    let active = true;

    async function poll() {
      try {
        const res = await fetch(`/api/jobs/${jobId}`);
        if (!res.ok || !active) return;
        const data = (await res.json()) as JobProgress;
        if (!active) return;
        setProgress(data);

        if (data.status === "completed" || data.status === "failed") {
          if (!completedRef.current) {
            completedRef.current = true;
            onCompleteRef.current?.(data);
          }
        }
      } catch {
        // ignore, will retry
      }
    }

    // Poll immediately, then every 1 second
    poll();
    const interval = setInterval(poll, 1000);

    return () => {
      active = false;
      clearInterval(interval);
    };
  }, [jobId]);

  if (progress === null) {
    return (
      <div className="rounded-xl border border-white/10 bg-white/[0.04] p-4">
        <div className="flex items-center gap-3">
          <div className="h-4 w-4 animate-spin rounded-full border-2 border-emerald-400 border-t-transparent" />
          <span className="text-sm text-slate-300">Iniciando...</span>
        </div>
      </div>
    );
  }

  const percent = progress.percent;
  const isComplete = progress.status === "completed";
  const isFailed = progress.status === "failed";
  const isActive = progress.status === "running" || progress.status === "pending";

  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.04] p-4">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          {isActive && (
            <div className="h-4 w-4 animate-spin rounded-full border-2 border-emerald-400 border-t-transparent" />
          )}
          {isComplete && (
            <div className="flex h-5 w-5 items-center justify-center rounded-full bg-emerald-500/20 text-emerald-400">
              <svg className="h-3 w-3" viewBox="0 0 12 12" fill="none">
                <path d="M2 6l3 3 5-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </div>
          )}
          {isFailed && (
            <div className="flex h-5 w-5 items-center justify-center rounded-full bg-red-500/20 text-red-400">
              <svg className="h-3 w-3" viewBox="0 0 12 12" fill="none">
                <path d="M3 3l6 6M9 3l-6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              </svg>
            </div>
          )}
          <span className="text-sm font-medium text-slate-200">
            {progress.type === "import" ? "Importando" : "Exportando"}
            {progress.module ? `: ${progress.module}` : ""}
          </span>
        </div>
        <span className="text-xs text-slate-400">
          {percent}%
        </span>
      </div>

      <div className="h-2 w-full overflow-hidden rounded-full bg-white/10">
        <div
          className={`h-full rounded-full transition-all duration-500 ${
            isFailed
              ? "bg-red-500"
              : isComplete
                ? "bg-emerald-500"
                : "bg-gradient-to-r from-emerald-500 to-cyan-400"
          }`}
          style={{ width: `${percent}%` }}
        />
      </div>

      <div className="mt-2">
        <span className="text-xs text-slate-400">{progress.phase}</span>
      </div>

      {isFailed && progress.error && (
        <div className="mt-3 rounded-lg bg-red-500/10 px-3 py-2 text-xs text-red-300">
          {progress.error}
        </div>
      )}
    </div>
  );
}
