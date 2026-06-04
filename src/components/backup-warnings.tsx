"use client";

import { useState } from "react";

type Props = {
  count: number;
  messages: string[];
  backupId: string;
};

/** Badge que muestra el número de warnings de un backup y un modal con los detalles. */
export function BackupWarnings({ count, messages, backupId }: Props) {
  const [open, setOpen] = useState(false);

  if (count === 0) {
    return (
      <span className="rounded-full bg-white/10 px-3 py-1 text-xs text-slate-300">
        warnings 0
      </span>
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-full bg-amber-300/15 px-3 py-1 text-xs font-bold text-amber-200 transition hover:bg-amber-300/25"
      >
        ⚠ warnings {count}
      </button>

      {open ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
          onClick={() => setOpen(false)}
        >
          <div
            className="w-full max-w-lg max-h-[80vh] overflow-y-auto rounded-[2rem] border border-amber-300/30 bg-slate-950 p-6 shadow-2xl shadow-amber-900/20"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-3">
              <div className="grid size-10 shrink-0 place-items-center rounded-full bg-amber-400/20 text-lg">
                ⚠
              </div>
              <div className="min-w-0">
                <p className="text-sm font-semibold tracking-[0.2em] text-amber-200 uppercase">
                  Warnings
                </p>
                <p className="mt-0.5 truncate font-mono text-[11px] text-slate-400">{backupId}</p>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="ml-auto grid size-8 shrink-0 place-items-center rounded-full bg-white/10 text-xs text-slate-300 hover:bg-white/20"
              >
                ✕
              </button>
            </div>

            <div className="mt-5 space-y-2">
              {messages.map((msg, i) => (
                <div
                  key={i}
                  className="rounded-xl border border-amber-300/15 bg-amber-300/[0.04] px-4 py-3 text-sm leading-5 text-amber-100/90"
                >
                  {msg}
                </div>
              ))}
            </div>

            <button
              type="button"
              onClick={() => setOpen(false)}
              className="mt-6 w-full rounded-2xl border border-amber-300/30 bg-amber-300/10 px-5 py-3 text-sm font-bold text-amber-200 transition hover:bg-amber-300/20"
            >
              Cerrar
            </button>
          </div>
        </div>
      ) : null}
    </>
  );
}
