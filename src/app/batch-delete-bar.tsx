"use client";

import { useEffect, useState } from "react";

import { CsrfTokenInput } from "./csrf-token";

type ServerAction = (formData: FormData) => Promise<void>;

/**
 * Barra de borrado masivo: checkbox "seleccionar todos", contador de backups
 * marcados y boton que abre la confirmacion de borrado en lote.
 *
 * Los checkboxes por fila viven fuera de este componente; se asocian a su formulario
 * mediante el atributo HTML `form="backup-batch-form"`. Este componente solo
 * gestiona el estado visual (contador y seleccionar todos) via DOM.
 */
export function BatchDeleteBar({
  csrfToken,
  listContainerId,
  confirmAction,
}: {
  csrfToken?: string | null | undefined;
  listContainerId: string;
  confirmAction: ServerAction;
}) {
  const [count, setCount] = useState(0);
  const [allChecked, setAllChecked] = useState(false);
  const [indeterminate, setIndeterminate] = useState(false);

  useEffect(() => {
    const container = document.getElementById(listContainerId);
    if (!container) {
      return;
    }

    const refresh = () => {
      const checks = container.querySelectorAll<HTMLInputElement>('input[name="backupIds"]');
      const checked = [...checks].filter((item) => item.checked);
      setCount(checked.length);
      setAllChecked(checks.length > 0 && checked.length === checks.length);
      setIndeterminate(checked.length > 0 && checked.length < checks.length);
    };

    refresh();
    container.addEventListener("change", refresh);
    return () => container.removeEventListener("change", refresh);
  }, [listContainerId]);

  function toggleAll(checked: boolean) {
    const container = document.getElementById(listContainerId);
    if (!container) {
      return;
    }
    container
      .querySelectorAll<HTMLInputElement>('input[name="backupIds"]')
      .forEach((item) => {
        item.checked = checked;
      });
    const length = container.querySelectorAll('input[name="backupIds"]').length;
    setCount(checked ? length : 0);
    setAllChecked(checked);
    setIndeterminate(false);
  }

  return (
    <div className="mt-4 flex flex-wrap items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.04] p-3">
      <label className="inline-flex cursor-pointer select-none items-center gap-2 text-xs font-semibold text-slate-300">
        <input
          type="checkbox"
          checked={allChecked}
          ref={(node) => {
            if (node) {
              node.indeterminate = indeterminate;
            }
          }}
          onChange={(event) => toggleAll(event.target.checked)}
          className="size-4 accent-emerald-300"
        />
        Seleccionar todos
      </label>

      <span className="rounded-full bg-white/10 px-3 py-1 text-xs font-bold text-emerald-200 tabular-nums">
        {count} seleccionado{count === 1 ? "" : "s"}
      </span>

      <form id="backup-batch-form" action={confirmAction} className="ml-auto">
        <CsrfTokenInput token={csrfToken} />
        <button
          type="submit"
          className="inline-flex items-center gap-1.5 rounded-full border border-red-300/30 bg-red-300/10 px-3 py-2 text-xs font-bold text-red-200 transition hover:bg-red-300/20 disabled:cursor-not-allowed disabled:opacity-40"
        >
          <svg className="size-3.5" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M2 4h12M5.333 4V2.667a1.333 1.333 0 0 1 1.334-1.334h2.666a1.333 1.333 0 0 1 1.334 1.334V4m2 0v9.333a1.333 1.333 0 0 1-1.334 1.334H4.667a1.333 1.333 0 0 1-1.334-1.334V4h9.334Z" />
          </svg>
          Eliminar seleccionados
        </button>
      </form>
    </div>
  );
}