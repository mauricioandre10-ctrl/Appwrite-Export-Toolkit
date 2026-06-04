"use client";

import { useEffect, useState } from "react";

/** Preset de programación cron que representa un patrón de ejecución conocido o una expresión personalizada. */
export type CronPreset =
  | { kind: "every-minute" }
  | { kind: "every-n-minutes"; n: number }
  | { kind: "every-n-hours"; n: number }
  | { kind: "daily-at"; hour: number; minute: number }
  | { kind: "weekly-at"; dayOfWeek: number; hour: number; minute: number }
  | { kind: "monthly-at"; day: number; hour: number; minute: number }
  | { kind: "custom"; expression: string };

const DAYS_OF_WEEK = [
  { value: 1, label: "Lunes" },
  { value: 2, label: "Martes" },
  { value: 3, label: "Miércoles" },
  { value: 4, label: "Jueves" },
  { value: 5, label: "Viernes" },
  { value: 6, label: "Sábado" },
  { value: 0, label: "Domingo" },
];

function presetToExpression(preset: CronPreset): string {
  switch (preset.kind) {
    case "every-minute":
      return "* * * * *";
    case "every-n-minutes":
      return `*/${preset.n} * * * *`;
    case "every-n-hours":
      return `0 */${preset.n} * * *`;
    case "daily-at":
      return `${preset.minute} ${preset.hour} * * *`;
    case "weekly-at":
      return `${preset.minute} ${preset.hour} * * ${preset.dayOfWeek}`;
    case "monthly-at":
      return `${preset.minute} ${preset.hour} ${preset.day} * *`;
    case "custom":
      return preset.expression;
  }
}

function describeInSpanish(preset: CronPreset): string {
  switch (preset.kind) {
    case "every-minute":
      return "Cada minuto";
    case "every-n-minutes":
      return `Cada ${preset.n} minutos`;
    case "every-n-hours":
      return `Cada ${preset.n} horas`;
    case "daily-at":
      return `Diario a las ${String(preset.hour).padStart(2, "0")}:${String(preset.minute).padStart(2, "0")}`;
    case "weekly-at": {
      const day = DAYS_OF_WEEK.find((d) => d.value === preset.dayOfWeek)?.label ?? "?";
      return `Semanal (${day}) a las ${String(preset.hour).padStart(2, "0")}:${String(preset.minute).padStart(2, "0")}`;
    }
    case "monthly-at":
      return `Mensual día ${preset.day} a las ${String(preset.hour).padStart(2, "0")}:${String(preset.minute).padStart(2, "0")}`;
    case "custom":
      return `Personalizado: ${preset.expression}`;
  }
}

function buildInitialPreset(expression: string): CronPreset {
  const parts = expression.trim().split(/\s+/);
  if (parts.length !== 5) {
    return { kind: "custom", expression };
  }

  const [minute, hour, dom, , dow] = parts;
  if (!minute || !hour || !dom || !dow) {
    return { kind: "custom", expression };
  }

  if (minute === "*" && hour === "*" && dom === "*" && dow === "*") {
    return { kind: "every-minute" };
  }

  const m = Number(minute);
  const h = Number(hour);

  if (minute.startsWith("*/") && hour === "*" && dom === "*" && dow === "*") {
    return { kind: "every-n-minutes", n: Number(minute.slice(2)) };
  }
  if (minute === "0" && hour.startsWith("*/") && dom === "*" && dow === "*") {
    return { kind: "every-n-hours", n: Number(hour.slice(2)) };
  }
  if (dom === "*" && dow === "*" && !Number.isNaN(m) && !Number.isNaN(h)) {
    return { kind: "daily-at", hour: h, minute: m };
  }
  if (dom === "*" && !Number.isNaN(Number(dow)) && !Number.isNaN(m) && !Number.isNaN(h)) {
    return { kind: "weekly-at", dayOfWeek: Number(dow), hour: h, minute: m };
  }
  if (!Number.isNaN(Number(dom)) && dow === "*" && !Number.isNaN(m) && !Number.isNaN(h)) {
    return { kind: "monthly-at", day: Number(dom), hour: h, minute: m };
  }
  return { kind: "custom", expression };
}

type Props = {
  value: string;
  onChange: (expression: string) => void;
};

/** Selector interactivo de programación cron con presets predefinidos y modo personalizado. */
export function ScheduleCronInput({ value, onChange }: Props) {
  const [preset, setPreset] = useState<CronPreset>(() => buildInitialPreset(value));
  const [customExpr, setCustomExpr] = useState<string>(value);

  // Reset local UI state when the parent value changes (e.g. switching to edit a different schedule).
  // This is a legitimate prop → state sync; the rule wants a `key` reset on the parent, but here we keep the
  // controlled input working without a key by syncing on the value change.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPreset(buildInitialPreset(value));
    setCustomExpr(value);
  }, [value]);

  function updatePreset(next: CronPreset) {
    setPreset(next);
    if (next.kind !== "custom") {
      onChange(presetToExpression(next));
    } else {
      onChange(next.expression);
    }
  }

  function updateCustom(expr: string) {
    setCustomExpr(expr);
    setPreset({ kind: "custom", expression: expr });
    onChange(expr);
  }

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <button
          type="button"
          onClick={() => updatePreset({ kind: "every-minute" })}
          className={buttonClass(preset.kind === "every-minute")}
        >
          Cada minuto
        </button>
        <button
          type="button"
          onClick={() => updatePreset({ kind: "every-n-minutes", n: 15 })}
          className={buttonClass(preset.kind === "every-n-minutes")}
        >
          Cada N min
        </button>
        <button
          type="button"
          onClick={() => updatePreset({ kind: "every-n-hours", n: 6 })}
          className={buttonClass(preset.kind === "every-n-hours")}
        >
          Cada N horas
        </button>
        <button
          type="button"
          onClick={() => updatePreset({ kind: "daily-at", hour: 0, minute: 0 })}
          className={buttonClass(preset.kind === "daily-at")}
        >
          Diario
        </button>
        <button
          type="button"
          onClick={() => updatePreset({ kind: "weekly-at", dayOfWeek: 1, hour: 2, minute: 0 })}
          className={buttonClass(preset.kind === "weekly-at")}
        >
          Semanal
        </button>
        <button
          type="button"
          onClick={() => updatePreset({ kind: "monthly-at", day: 1, hour: 0, minute: 0 })}
          className={buttonClass(preset.kind === "monthly-at")}
        >
          Mensual
        </button>
        <button
          type="button"
          onClick={() => updatePreset({ kind: "custom", expression: customExpr })}
          className={`col-span-2 ${buttonClass(preset.kind === "custom")}`}
        >
          Custom (cron)
        </button>
      </div>

      {preset.kind === "every-n-minutes" && (
        <NumberField
          label="Cada cuántos minutos"
          value={preset.n}
          min={1}
          max={59}
          onChange={(n) => updatePreset({ kind: "every-n-minutes", n })}
        />
      )}
      {preset.kind === "every-n-hours" && (
        <NumberField
          label="Cada cuántas horas"
          value={preset.n}
          min={1}
          max={23}
          onChange={(n) => updatePreset({ kind: "every-n-hours", n })}
        />
      )}
      {preset.kind === "daily-at" && (
        <TimeField
          label="Hora del día"
          hour={preset.hour}
          minute={preset.minute}
          onChange={(hour, minute) => updatePreset({ kind: "daily-at", hour, minute })}
        />
      )}
      {preset.kind === "weekly-at" && (
        <div className="space-y-2">
          <label className="block">
            <span className="text-xs font-semibold tracking-wider text-slate-400 uppercase">Día de la semana</span>
            <select
              value={preset.dayOfWeek}
              onChange={(e) => updatePreset({ kind: "weekly-at", dayOfWeek: Number(e.target.value), hour: preset.hour, minute: preset.minute })}
              className="mt-1.5 w-full rounded-2xl border border-white/10 bg-slate-950/70 px-4 py-3 text-white outline-none transition focus:border-violet-300/60"
            >
              {DAYS_OF_WEEK.map((d) => (
                <option key={d.value} value={d.value}>
                  {d.label}
                </option>
              ))}
            </select>
          </label>
          <TimeField
            label="Hora"
            hour={preset.hour}
            minute={preset.minute}
            onChange={(hour, minute) => updatePreset({ kind: "weekly-at", dayOfWeek: preset.dayOfWeek, hour, minute })}
          />
        </div>
      )}
      {preset.kind === "monthly-at" && (
        <div className="space-y-2">
          <NumberField
            label="Día del mes"
            value={preset.day}
            min={1}
            max={31}
            onChange={(day) => updatePreset({ kind: "monthly-at", day, hour: preset.hour, minute: preset.minute })}
          />
          <TimeField
            label="Hora"
            hour={preset.hour}
            minute={preset.minute}
            onChange={(hour, minute) => updatePreset({ kind: "monthly-at", day: preset.day, hour, minute })}
          />
        </div>
      )}
      {preset.kind === "custom" && (
        <label className="block">
          <span className="text-xs font-semibold tracking-wider text-slate-400 uppercase">Expresión cron (5 partes)</span>
          <input
            type="text"
            value={customExpr}
            onChange={(e) => updateCustom(e.target.value)}
            placeholder="0 0 * * *"
            className="mt-1.5 w-full rounded-2xl border border-white/10 bg-slate-950/70 px-4 py-3 font-mono text-sm text-white outline-none transition focus:border-violet-300/60"
          />
          <span className="mt-1 block text-[11px] text-slate-500">
            Formato: <code className="text-slate-300">minuto hora día-mes mes día-semana</code>. Ej: <code className="text-slate-300">0 2 * * *</code> = diario 02:00.
          </span>
        </label>
      )}

      <div className="rounded-2xl border border-violet-300/15 bg-violet-300/[0.05] p-3">
        <p className="text-[11px] font-semibold tracking-wider text-violet-200 uppercase">Resumen</p>
        <p className="mt-1 font-mono text-xs text-slate-200">{value}</p>
        <p className="mt-1 text-[11px] text-slate-400">{describeInSpanish(preset)}</p>
      </div>
    </div>
  );
}

function buttonClass(active: boolean): string {
  return `rounded-xl border px-3 py-2 text-xs font-semibold transition ${
    active
      ? "border-violet-300/50 bg-violet-300/15 text-violet-100"
      : "border-white/10 bg-slate-950/50 text-slate-300 hover:border-violet-300/30"
  }`;
}

function NumberField({
  label,
  value,
  min,
  max,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (n: number) => void;
}) {
  return (
    <label className="block">
      <span className="text-xs font-semibold tracking-wider text-slate-400 uppercase">{label}</span>
      <input
        type="number"
        value={value}
        min={min}
        max={max}
        onChange={(e) => {
          const n = Number(e.target.value);
          if (Number.isFinite(n) && n >= min && n <= max) onChange(Math.floor(n));
        }}
        className="mt-1.5 w-full rounded-2xl border border-white/10 bg-slate-950/70 px-4 py-3 text-white outline-none transition focus:border-violet-300/60"
      />
    </label>
  );
}

function TimeField({
  label,
  hour,
  minute,
  onChange,
}: {
  label: string;
  hour: number;
  minute: number;
  onChange: (hour: number, minute: number) => void;
}) {
  return (
    <label className="block">
      <span className="text-xs font-semibold tracking-wider text-slate-400 uppercase">{label}</span>
      <div className="mt-1.5 flex items-center gap-2">
        <input
          type="number"
          value={hour}
          min={0}
          max={23}
          onChange={(e) => {
            const h = Number(e.target.value);
            if (Number.isFinite(h) && h >= 0 && h <= 23) onChange(Math.floor(h), minute);
          }}
          className="w-20 rounded-2xl border border-white/10 bg-slate-950/70 px-4 py-3 text-center text-white outline-none transition focus:border-violet-300/60"
        />
        <span className="text-slate-400">:</span>
        <input
          type="number"
          value={minute}
          min={0}
          max={59}
          onChange={(e) => {
            const m = Number(e.target.value);
            if (Number.isFinite(m) && m >= 0 && m <= 59) onChange(hour, Math.floor(m));
          }}
          className="w-20 rounded-2xl border border-white/10 bg-slate-950/70 px-4 py-3 text-center text-white outline-none transition focus:border-violet-300/60"
        />
      </div>
    </label>
  );
}

export { describeInSpanish };
