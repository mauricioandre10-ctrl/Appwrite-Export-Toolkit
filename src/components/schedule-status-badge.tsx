"use client";

type Status = "success" | "failed" | "running" | "unknown";

type Props = {
  status?: string | undefined;
  className?: string | undefined;
};

function tone(status: Status): string {
  switch (status) {
    case "success":
      return "border-emerald-300/30 bg-emerald-300/15 text-emerald-200";
    case "failed":
      return "border-red-300/30 bg-red-300/15 text-red-200";
    case "running":
      return "border-sky-300/30 bg-sky-300/15 text-sky-200";
    default:
      return "border-white/10 bg-white/5 text-slate-300";
  }
}

function label(status: Status): string {
  switch (status) {
    case "success":
      return "OK";
    case "failed":
      return "Error";
    case "running":
      return "En curso";
    default:
      return "—";
  }
}

/** Badge visual que muestra el estado de una ejecución (éxito, error, en curso o desconocido). */
export function ScheduleStatusBadge({ status, className = "" }: Props) {
  const normalized: Status =
    status === "success" || status === "failed" || status === "running" ? status : "unknown";

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[10px] font-bold ${tone(normalized)} ${className}`}
    >
      {normalized === "running" ? (
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-current" />
      ) : normalized === "success" ? (
        <svg className="h-3 w-3" viewBox="0 0 12 12" fill="none">
          <path d="M2 6l3 3 5-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      ) : normalized === "failed" ? (
        <svg className="h-3 w-3" viewBox="0 0 12 12" fill="none">
          <path d="M3 3l6 6M9 3l-6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
      ) : null}
      {label(normalized)}
    </span>
  );
}
