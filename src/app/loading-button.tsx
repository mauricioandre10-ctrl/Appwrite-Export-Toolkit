"use client";

import { useFormStatus } from "react-dom";

export function LoadingSubmitButton({
  label,
  module: moduleName,
  disabled,
  actionType = "export",
}: {
  label: string;
  module: string;
  disabled?: boolean;
  actionType?: "export" | "import";
}) {
  const { pending } = useFormStatus();
  const actionLabel = actionType === "import" ? "Importando" : "Exportando";

  return (
    <button
      disabled={disabled || pending}
      className="group relative h-14 w-full overflow-hidden rounded-2xl border border-white/10 bg-slate-950/70 px-4 text-sm font-bold text-white transition hover:border-emerald-300/50 hover:bg-emerald-300/10 disabled:cursor-not-allowed disabled:opacity-50"
    >
      <span className={`transition ${pending ? "opacity-0" : ""}`}>{label}</span>
      {pending ? (
        <span className="absolute inset-0 flex items-center justify-center gap-2">
          <Spinner />
          <span className="text-emerald-200">{actionLabel} {moduleName === "all" ? "todos" : moduleName}...</span>
        </span>
      ) : null}
    </button>
  );
}

export function LoginSubmitButton({ configReady }: { configReady: boolean }) {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      disabled={!configReady || pending}
      className="relative w-full overflow-hidden rounded-2xl bg-emerald-300 px-5 py-3 font-bold text-slate-950 transition hover:bg-emerald-200 disabled:cursor-not-allowed disabled:bg-slate-600 disabled:text-slate-300"
    >
      <span className={`transition ${pending ? "opacity-0" : ""}`}>Entrar al panel</span>
      {pending ? (
        <span className="absolute inset-0 flex items-center justify-center gap-2">
          <Spinner />
          <span>Iniciando sesion...</span>
        </span>
      ) : null}
    </button>
  );
}

function Spinner() {
  return (
    <svg className="size-4 animate-spin text-emerald-300" viewBox="0 0 24 24" fill="none">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
    </svg>
  );
}
