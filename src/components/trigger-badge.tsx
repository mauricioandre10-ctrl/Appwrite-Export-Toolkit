"use client";

type Trigger = "manual" | "scheduled";

type Props = {
  trigger?: Trigger | string | undefined;
  className?: string | undefined;
};

function isManual(trigger: Trigger | string | undefined): boolean {
  return trigger === "manual";
}

export function TriggerBadge({ trigger, className = "" }: Props) {
  const manual = isManual(trigger);

  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-bold ${
        manual
          ? "border-amber-300/30 bg-amber-300/10 text-amber-200"
          : "border-sky-300/20 bg-sky-300/10 text-sky-200"
      } ${className}`}
      title={manual ? "Ejecutado manualmente desde el panel" : "Ejecutado por el cron automáticamente"}
    >
      {manual ? (
        <svg className="h-3 w-3" viewBox="0 0 12 12" fill="currentColor">
          <path d="M3 2v8l7-4-7-4z" />
        </svg>
      ) : (
        <svg className="h-3 w-3" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="6" cy="7" r="4" />
          <path d="M6 5v2l1.2 1M4 1.5v1M8 1.5v1" />
        </svg>
      )}
      {manual ? "Manual" : "Auto"}
    </span>
  );
}
