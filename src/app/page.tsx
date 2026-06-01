import { createHash, timingSafeEqual } from "node:crypto";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { createAppwriteServices } from "@/server/appwrite/client";
import { loadAppwriteConfig } from "@/server/appwrite/config";
import type { BackupSummary } from "@/server/backups/catalog";
import { LoadingSubmitButton, LoginSubmitButton } from "./loading-button";
import { listBackupSummaries, resolveManagedBackupPath } from "@/server/backups/catalog";
import { exportBackup, parseExportSelection } from "@/server/exporters/export-orchestrator";
import { validateBackup } from "@/server/validators/backup-validator";

const sessionCookieName = "appwrite_export_toolkit_session";

type PageProps = {
  searchParams?: Promise<{
    error?: string;
    loggedOut?: string;
    exported?: string;
    exportModule?: string;
    validated?: string;
    validationErrors?: string;
    validationWarnings?: string;
    actionError?: string;
  }>;
};

export default async function Home({ searchParams }: PageProps) {
  const loginConfig = getLoginConfig();
  const cookieStore = await cookies();
  const sessionCookie = cookieStore.get(sessionCookieName)?.value;
  const isAuthenticated =
    loginConfig.ready && sessionCookie === createSessionToken(loginConfig.user, loginConfig.password);
  const params = await searchParams;

  if (isAuthenticated) {
    const dashboardData = await getDashboardData();

    return (
      <DashboardShell
        backups={dashboardData.backups}
        outputDir={dashboardData.outputDir}
        configError={dashboardData.configError}
        params={params}
      />
    );
  }

  return (
    <main className="min-h-screen overflow-hidden bg-[#071015] text-slate-50">
      <BackgroundGlow />
      <div className="relative mx-auto flex min-h-screen w-full max-w-6xl flex-col px-6 py-8 sm:px-8 lg:px-10">
        <BrandHeader />

        <section className="grid flex-1 items-center gap-10 py-14 lg:grid-cols-[1.08fr_0.92fr]">
          <HeroCopy />

          <div className="rounded-[2rem] border border-white/10 bg-white/[0.07] p-6 shadow-2xl shadow-black/40 backdrop-blur-xl">
            <LoginPanel
              action={loginAction}
              configReady={loginConfig.ready}
              hasError={params?.error === "invalid"}
              loggedOut={params?.loggedOut === "1"}
            />
          </div>
        </section>
      </div>
    </main>
  );
}

function DashboardShell({
  backups,
  outputDir,
  configError,
  params,
}: {
  backups: BackupSummary[];
  outputDir: string;
  configError: string | null;
  params?: Awaited<PageProps["searchParams"]>;
}) {
  const latest = backups[0];
  const totalFiles = latest?.counts.files ?? 0;
  const totalDocuments = latest?.counts.documents ?? 0;
  const totalChecksums = latest?.checksums ?? 0;

  return (
    <main className="min-h-screen bg-[#071015] text-slate-50">
      <BackgroundGlow />
      <div className="relative mx-auto flex min-h-screen w-full max-w-7xl flex-col px-4 py-5 sm:px-6 lg:px-8">
        <header className="flex flex-col gap-4 rounded-[1.75rem] border border-white/10 bg-white/[0.06] p-4 backdrop-blur-xl sm:flex-row sm:items-center sm:justify-between">
          <BrandHeader compact />
          <div className="flex flex-wrap items-center gap-3">
            <span className="rounded-full border border-emerald-300/20 bg-emerald-300/10 px-4 py-2 text-xs font-semibold text-emerald-100">
              {outputDir}
            </span>
            <form action={logoutAction}>
              <button className="rounded-full border border-white/10 px-4 py-2 text-sm font-semibold text-white transition hover:bg-white/10">
                Cerrar sesion
              </button>
            </form>
          </div>
        </header>

        <section className="grid gap-5 py-6 lg:grid-cols-[1.1fr_0.9fr]">
          <div className="rounded-[2rem] border border-white/10 bg-slate-950/50 p-6 shadow-2xl shadow-black/20">
            <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
              <div>
                <p className="text-sm font-semibold tracking-[0.24em] text-emerald-200 uppercase">
                  Centro de control
                </p>
                <h1 className="mt-3 max-w-2xl text-4xl font-black tracking-tight text-white sm:text-5xl">
                  Exports Appwrite listos para volumen persistente.
                </h1>
                <p className="mt-4 max-w-2xl text-sm leading-6 text-slate-300 sm:text-base">
                  Lanza backups por modulo, valida integridad y revisa estado por recurso sin salir del panel.
                </p>
              </div>
              <StatusPill status={latest?.moduleStatus.functions === "partial" ? "partial" : "complete"} />
            </div>

            <div className="mt-8 grid gap-3 sm:grid-cols-3">
              <DashboardMetric label="Backups" value={String(backups.length)} tone="emerald" />
              <DashboardMetric label="Documentos" value={String(totalDocuments)} tone="blue" />
              <DashboardMetric label="Archivos" value={String(totalFiles)} tone="violet" />
            </div>

            <div className="mt-3 grid gap-3 sm:grid-cols-3">
              <DashboardMetric label="Checksums" value={String(totalChecksums)} tone="amber" />
              <DashboardMetric label="Funciones" value={String(latest?.counts.functions ?? 0)} tone="rose" />
              <DashboardMetric label="Storage" value={latest?.moduleStatus.storage ?? "sin datos"} tone="slate" />
            </div>
          </div>

          <ActionPanel configError={configError} />
        </section>

        <AlertPanel params={params} configError={configError} />

        <section className="grid gap-5 pb-8 lg:grid-cols-[0.95fr_1.05fr]">
          <LatestBackupCard backup={latest} />
          <BackupHistory backups={backups} />
        </section>
      </div>
    </main>
  );
}

function ActionPanel({ configError }: { configError: string | null }) {
  const modules = ["all", "auth", "messaging", "databases", "storage", "functions"];

  return (
    <div className="rounded-[2rem] border border-white/10 bg-white/[0.07] p-6 shadow-2xl shadow-black/30 backdrop-blur-xl">
      <p className="text-sm font-semibold tracking-[0.24em] text-emerald-200 uppercase">Acciones</p>
      <h2 className="mt-3 text-2xl font-black text-white">Nuevo export</h2>
      <p className="mt-2 text-sm leading-6 text-slate-300">
        Cada accion escribe en `BACKUP_OUTPUT_DIR` y genera manifest, checksums, logs y estado por modulo.
      </p>

      <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3">
        {modules.map((moduleName) => (
          <form key={moduleName} action={exportAction}>
            <input name="module" type="hidden" value={moduleName} />
            <LoadingSubmitButton
              label={moduleName === "all" ? "Export all" : moduleName}
              module={moduleName}
              disabled={configError !== null}
            />
          </form>
        ))}
      </div>
    </div>
  );
}

function AlertPanel({
  params,
  configError,
}: {
  params?: Awaited<PageProps["searchParams"]>;
  configError: string | null;
}) {
  if (configError !== null) {
    return <PanelAlert tone="error" title="Configuracion incompleta" message={configError} />;
  }

  if (params?.exported !== undefined) {
    return (
      <PanelAlert
        tone="success"
        title="Export completado"
        message={`Backup ${params.exported} generado desde modulo ${params.exportModule ?? "all"}.`}
      />
    );
  }

  if (params?.validated !== undefined) {
    return (
      <PanelAlert
        tone={params.validationErrors === "0" ? "success" : "error"}
        title="Validacion completada"
        message={`Backup ${params.validated}: ${params.validationErrors ?? "0"} errores, ${params.validationWarnings ?? "0"} warnings.`}
      />
    );
  }

  if (params?.actionError !== undefined) {
    return <PanelAlert tone="error" title="Accion fallida" message={params.actionError.replaceAll("_", " ")} />;
  }

  return null;
}

function LatestBackupCard({ backup }: { backup: BackupSummary | undefined }) {
  if (backup === undefined) {
    return (
      <div className="rounded-[2rem] border border-dashed border-white/15 bg-white/[0.04] p-6">
        <p className="text-sm font-semibold tracking-[0.24em] text-slate-400 uppercase">Sin backups</p>
        <h2 className="mt-3 text-2xl font-black text-white">Lanza tu primer export</h2>
        <p className="mt-2 text-sm text-slate-300">El historial aparecera aqui despues del primer backup.</p>
      </div>
    );
  }

  return (
    <div className="rounded-[2rem] border border-white/10 bg-white/[0.06] p-6">
      <p className="text-sm font-semibold tracking-[0.24em] text-emerald-200 uppercase">Ultimo backup</p>
      <h2 className="mt-3 break-all text-2xl font-black text-white">{backup.backupId}</h2>
      <p className="mt-2 text-sm text-slate-400">{formatDate(backup.exportedAt)}</p>

      <div className="mt-6 grid gap-3 sm:grid-cols-2">
        {Object.entries(backup.moduleStatus).map(([moduleName, status]) => (
          <div key={moduleName} className="rounded-2xl border border-white/10 bg-slate-950/60 p-4">
            <div className="flex items-center justify-between">
              <p className="text-xs tracking-[0.2em] text-slate-500 uppercase">{moduleName}</p>
              <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${status === "complete" ? "bg-emerald-300/20 text-emerald-200" : status === "partial" ? "bg-amber-300/20 text-amber-200" : "bg-white/10 text-slate-400"}`}>
                {status === "complete" ? "100%" : status === "partial" ? "65%" : "0%"}
              </span>
            </div>
            <div className="mt-2">
              <ProgressBar percent={status === "complete" ? 100 : status === "partial" ? 65 : 0} size="sm" />
            </div>
          </div>
        ))}
      </div>

      <div className="mt-5">
        <ProgressBar percent={backup.progress} />
      </div>

      {backup.latestLogs.length > 0 ? (
        <div className="mt-5">
          <p className="text-xs font-semibold tracking-[0.2em] text-slate-400 uppercase">Logs recientes</p>
          <div className="mt-2 max-h-48 space-y-1.5 overflow-auto pr-1">
            {backup.latestLogs.map((entry, i) => (
              <LogEntryRow key={i} entry={entry} />
            ))}
          </div>
        </div>
      ) : null}

      <div className="mt-6 flex flex-col gap-3 sm:flex-row">
        <form action={validateAction} className="flex-1">
          <input name="backupId" type="hidden" value={backup.backupId} />
          <SubmitButton label="Validar" icon="check" />
        </form>
        <form
          method="POST"
          action={`/api/backups/${encodeURIComponent(backup.backupId)}/download`}
          className="flex-1"
        >
          <button
            type="submit"
            className="flex h-12 w-full items-center justify-center gap-2 rounded-2xl border border-emerald-300/30 bg-emerald-300/10 px-5 font-bold text-emerald-200 transition hover:bg-emerald-300/20"
          >
            <DownloadIcon /> Descargar .tar.gz
          </button>
        </form>
      </div>
    </div>
  );
}

function BackupHistory({ backups }: { backups: BackupSummary[] }) {
  return (
    <div className="rounded-[2rem] border border-white/10 bg-slate-950/50 p-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="text-sm font-semibold tracking-[0.24em] text-emerald-200 uppercase">Historial</p>
          <h2 className="mt-3 text-2xl font-black text-white">Backups persistentes</h2>
        </div>
        <span className="rounded-full bg-white/10 px-3 py-1 text-xs text-slate-300">{backups.length}</span>
      </div>

      <div className="mt-6 max-h-[34rem] space-y-3 overflow-auto pr-1">
        {backups.map((backup) => (
          <div key={backup.backupId} className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0">
                <p className="break-all font-mono text-xs text-slate-300">{backup.backupId}</p>
                <p className="mt-1 text-xs text-slate-500">{formatDate(backup.exportedAt)}</p>
              </div>
              <div className="flex items-center gap-2">
                <form
                  method="POST"
                  action={`/api/backups/${encodeURIComponent(backup.backupId)}/download`}
                >
                  <button
                    type="submit"
                    className="inline-flex items-center gap-1.5 rounded-full border border-emerald-300/30 bg-emerald-300/10 px-3 py-2 text-xs font-bold text-emerald-200 transition hover:bg-emerald-300/20"
                  >
                    <DownloadIcon /> Descargar
                  </button>
                </form>
                <form action={validateAction}>
                  <input name="backupId" type="hidden" value={backup.backupId} />
                  <SubmitButton label="Validar" icon="check" compact />
                </form>
              </div>
            </div>
            <div className="mt-3">
              <ProgressBar percent={backup.progress} size="sm" />
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              <MiniChip label={`docs ${backup.counts.documents ?? 0}`} />
              <MiniChip label={`files ${backup.counts.files ?? 0}`} />
              <MiniChip label={`sha ${backup.checksums}`} />
              <MiniChip label={`warnings ${backup.warnings}`} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function LoginPanel({
  action,
  configReady,
  hasError,
  loggedOut,
}: {
  action: (formData: FormData) => Promise<void>;
  configReady: boolean;
  hasError: boolean;
  loggedOut: boolean;
}) {
  return (
    <div>
      <p className="text-sm font-semibold tracking-[0.24em] text-emerald-200 uppercase">Acceso privado</p>
      <h2 className="mt-3 text-3xl font-black text-white">Iniciar sesion</h2>
      <p className="mt-3 text-sm leading-6 text-slate-300">
        Usa las credenciales configuradas en `APP_LOGIN_USER` y `APP_LOGIN_PASSWORD`.
      </p>

      {!configReady ? <InlineNotice tone="warning" message="Configura APP_LOGIN_USER y APP_LOGIN_PASSWORD." /> : null}
      {hasError ? <InlineNotice tone="error" message="Usuario o password incorrectos." /> : null}
      {loggedOut ? <InlineNotice tone="success" message="Sesion cerrada correctamente." /> : null}

      <form action={action} className="mt-7 space-y-5">
        <label className="block">
          <span className="text-sm font-medium text-slate-200">Usuario</span>
          <input
            name="user"
            type="text"
            autoComplete="username"
            className="mt-2 w-full rounded-2xl border border-white/10 bg-slate-950/70 px-4 py-3 text-white outline-none transition focus:border-emerald-300/60"
            placeholder="admin"
            required
          />
        </label>

        <label className="block">
          <span className="text-sm font-medium text-slate-200">Password</span>
          <input
            name="password"
            type="password"
            autoComplete="current-password"
            className="mt-2 w-full rounded-2xl border border-white/10 bg-slate-950/70 px-4 py-3 text-white outline-none transition focus:border-emerald-300/60"
            placeholder="••••••••"
            required
          />
        </label>

        <LoginSubmitButton configReady={configReady} />
      </form>
    </div>
  );
}

function MiniChip({ label }: { label: string }) {
  return <span className="rounded-full bg-white/10 px-3 py-1 text-xs text-slate-300">{label}</span>;
}

function ProgressBar({ percent, size = "md" }: { percent: number; size?: "sm" | "md" }) {
  const clamped = Math.max(0, Math.min(100, percent));
  const height = size === "sm" ? "h-1.5" : "h-3";
  const textSize = size === "sm" ? "text-[10px]" : "text-xs";

  const color =
    clamped >= 100
      ? "bg-emerald-400"
      : clamped >= 65
        ? "bg-amber-400"
        : clamped > 0
          ? "bg-sky-400"
          : "bg-white/20";

  return (
    <div className="flex items-center gap-3">
      <div className={`relative w-full overflow-hidden rounded-full bg-white/10 ${height}`}>
        <div
          className={`absolute inset-y-0 left-0 rounded-full transition-all duration-700 ease-out ${color}`}
          style={{ width: `${clamped}%` }}
        />
      </div>
      <span className={`${textSize} w-10 text-right font-bold tabular-nums text-slate-300`}>{clamped}%</span>
    </div>
  );
}

function LogEntryRow({ entry }: { entry: import("@/server/backups/catalog").BackupLogEntry }) {
  const levelStyle =
    entry.level === "ERROR"
      ? "bg-red-400/20 text-red-300"
      : entry.level === "WARN"
        ? "bg-amber-400/20 text-amber-300"
        : "bg-sky-400/15 text-sky-300";

  return (
    <div className="flex items-start gap-2 rounded-lg bg-white/[0.03] px-3 py-1.5 font-mono text-[11px] leading-5">
      <span className="shrink-0 text-slate-600">{formatLogTimestamp(entry.timestamp)}</span>
      <span className={`shrink-0 rounded px-1.5 py-0.5 text-[9px] font-bold ${levelStyle}`}>{entry.level}</span>
      <span className="min-w-0 flex-1 truncate text-slate-300">{entry.message}</span>
    </div>
  );
}

function DownloadIcon() {
  return (
    <svg className="size-3.5" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M8 2v9M4.5 7.5 8 11l3.5-3.5M3 13h10" />
    </svg>
  );
}

function SubmitButton({ label, icon, compact }: { label: string; icon?: "check" | "download"; compact?: boolean }) {
  return (
    <button
      className={`inline-flex items-center justify-center gap-1.5 rounded-full border border-white/10 bg-white/5 font-bold text-white transition hover:bg-white/10 ${compact ? "px-3 py-2 text-xs" : "w-full px-5 py-3 text-sm"}`}
    >
      {icon === "check" ? (
        <svg className="size-3.5" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M3 8.5l3.5 3.5L13 4" />
        </svg>
      ) : icon === "download" ? (
        <DownloadIcon />
      ) : null}
      {label}
    </button>
  );
}

function formatLogTimestamp(timestamp: string): string {
  try {
    const date = new Date(timestamp);
    if (Number.isNaN(date.getTime())) {
      return "--:--:--";
    }
    return new Intl.DateTimeFormat("es", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    }).format(date);
  } catch {
    return "--:--:--";
  }
}

function BackgroundGlow() {
  return (
    <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(circle_at_top_left,#23d3a640,transparent_34%),radial-gradient(circle_at_bottom_right,#4f46e540,transparent_34%)]" />
  );
}

function BrandHeader({ compact = false }: { compact?: boolean }) {
  return (
    <div className="flex items-center gap-3">
      <div className="grid size-11 place-items-center rounded-2xl border border-emerald-300/30 bg-emerald-300/10 font-mono text-sm font-bold text-emerald-200">
        AET
      </div>
      <div>
        <p className="text-sm font-semibold tracking-[0.28em] text-emerald-200/80 uppercase">
          Appwrite Export Toolkit
        </p>
        <p className="text-xs text-slate-400">
          {compact ? "Panel operativo" : "Backup logico, validacion y restore controlado"}
        </p>
      </div>
    </div>
  );
}

function HeroCopy() {
  return (
    <div className="max-w-2xl">
      <div className="mb-6 inline-flex rounded-full border border-emerald-300/20 bg-emerald-300/10 px-4 py-2 text-sm text-emerald-100">
        Exports persistentes en /data/backups
      </div>
      <h1 className="text-4xl font-black tracking-tight text-white sm:text-6xl">
        Controla tus backups Appwrite sin depender del servidor fisico.
      </h1>
      <p className="mt-6 max-w-xl text-lg leading-8 text-slate-300">
        Exporta Auth, Databases, Storage, Functions y Messaging en archivos estructurados,
        verificables y listos para migracion entre instancias.
      </p>

      <div className="mt-8 grid max-w-xl gap-3 sm:grid-cols-3">
        <DashboardMetric label="Modulos" value="5" tone="emerald" />
        <DashboardMetric label="Formato" value="NDJSON" tone="blue" />
        <DashboardMetric label="Integridad" value="SHA256" tone="amber" />
      </div>
    </div>
  );
}

function DashboardMetric({ label, value, tone }: { label: string; value: string; tone: string }) {
  const toneClass = {
    emerald: "border-emerald-300/20 bg-emerald-300/10 text-emerald-100",
    blue: "border-sky-300/20 bg-sky-300/10 text-sky-100",
    violet: "border-violet-300/20 bg-violet-300/10 text-violet-100",
    amber: "border-amber-300/20 bg-amber-300/10 text-amber-100",
    rose: "border-rose-300/20 bg-rose-300/10 text-rose-100",
    slate: "border-white/10 bg-white/[0.06] text-slate-100",
  }[tone] ?? "border-white/10 bg-white/[0.06] text-slate-100";

  return (
    <div className={`rounded-2xl border p-4 ${toneClass}`}>
      <p className="truncate text-2xl font-black">{value}</p>
      <p className="mt-1 text-xs tracking-[0.2em] opacity-70 uppercase">{label}</p>
    </div>
  );
}

function StatusPill({ status }: { status: "complete" | "partial" }) {
  return (
    <div className={`rounded-full px-4 py-2 text-sm font-bold ${status === "complete" ? "bg-emerald-300 text-slate-950" : "bg-amber-300 text-slate-950"}`}>
      {status === "complete" ? "Export completo" : "Export parcial"}
    </div>
  );
}

function PanelAlert({ tone, title, message }: { tone: "success" | "error"; title: string; message: string }) {
  const toneClass = tone === "success" ? "border-emerald-300/20 bg-emerald-300/10 text-emerald-100" : "border-red-300/20 bg-red-300/10 text-red-100";

  return (
    <div className={`mb-6 rounded-[1.5rem] border p-4 ${toneClass}`}>
      <p className="font-bold">{title}</p>
      <p className="mt-1 text-sm opacity-85">{message}</p>
    </div>
  );
}

function InlineNotice({ tone, message }: { tone: "success" | "warning" | "error"; message: string }) {
  const toneClass = {
    success: "border-emerald-300/30 bg-emerald-300/10 text-emerald-100",
    warning: "border-amber-300/30 bg-amber-300/10 text-amber-100",
    error: "border-red-300/30 bg-red-400/10 text-red-100",
  }[tone];

  return <div className={`mt-6 rounded-2xl border p-4 text-sm ${toneClass}`}>{message}</div>;
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("es", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

async function getDashboardData(): Promise<{
  backups: BackupSummary[];
  outputDir: string;
  configError: string | null;
}> {
  try {
    const config = loadAppwriteConfig();

    return {
      backups: await listBackupSummaries(config.BACKUP_OUTPUT_DIR),
      outputDir: config.BACKUP_OUTPUT_DIR,
      configError: null,
    };
  } catch (error) {
    return {
      backups: [],
      outputDir: "sin configurar",
      configError: error instanceof Error ? error.message : "Configuracion invalida.",
    };
  }
}

async function exportAction(formData: FormData) {
  "use server";

  await requireAuthenticated();

  let backupId: string;
  const moduleName = String(formData.get("module") ?? "all");

  try {
    const config = loadAppwriteConfig();
    const services = createAppwriteServices(config);
    const selection = parseExportSelection(moduleName);
    const result = await exportBackup({ selection, config, services });
    backupId = result.backupId;
  } catch (error) {
    const reason = error instanceof Error ? error.message.slice(0, 80).replaceAll(" ", "_") : "export_failed";
    redirect(`/?actionError=${encodeURIComponent(reason)}`);
  }

  redirect(`/?exported=${encodeURIComponent(backupId)}&exportModule=${encodeURIComponent(moduleName)}`);
}

async function validateAction(formData: FormData) {
  "use server";

  await requireAuthenticated();

  const backupId = String(formData.get("backupId") ?? "");
  let errors = 0;
  let warnings = 0;

  try {
    const config = loadAppwriteConfig();
    const backupPath = resolveManagedBackupPath(config.BACKUP_OUTPUT_DIR, backupId);
    const result = await validateBackup(backupPath);
    errors = result.counts.errors;
    warnings = result.counts.warnings;
  } catch (error) {
    const reason = error instanceof Error ? error.message.slice(0, 80).replaceAll(" ", "_") : "validate_failed";
    redirect(`/?actionError=${encodeURIComponent(reason)}`);
  }

  redirect(
    `/?validated=${encodeURIComponent(backupId)}&validationErrors=${errors}&validationWarnings=${warnings}`,
  );
}

async function loginAction(formData: FormData) {
  "use server";

  const loginConfig = getLoginConfig();
  const user = String(formData.get("user") ?? "");
  const password = String(formData.get("password") ?? "");

  if (!loginConfig.ready || !safeEqual(user, loginConfig.user) || !safeEqual(password, loginConfig.password)) {
    redirect("/?error=invalid");
  }

  const cookieStore = await cookies();
  cookieStore.set(sessionCookieName, createSessionToken(loginConfig.user, loginConfig.password), {
    httpOnly: true,
    sameSite: "lax",
    secure: false,
    path: "/",
    maxAge: 60 * 60 * 8,
  });

  redirect("/");
}

async function logoutAction() {
  "use server";

  const cookieStore = await cookies();
  cookieStore.delete(sessionCookieName);
  redirect("/?loggedOut=1");
}

async function requireAuthenticated(): Promise<void> {
  const loginConfig = getLoginConfig();
  const cookieStore = await cookies();
  const sessionCookie = cookieStore.get(sessionCookieName)?.value;

  if (!loginConfig.ready || sessionCookie !== createSessionToken(loginConfig.user, loginConfig.password)) {
    redirect("/?error=invalid");
  }
}

function getLoginConfig() {
  const user = process.env.APP_LOGIN_USER ?? "";
  const password = process.env.APP_LOGIN_PASSWORD ?? "";

  return {
    ready: user.length > 0 && password.length > 0,
    user,
    password,
  };
}

function createSessionToken(user: string, password: string): string {
  return createHash("sha256").update(`${user}:${password}`).digest("hex");
}

function safeEqual(input: string, expected: string): boolean {
  const inputHash = createHash("sha256").update(input).digest();
  const expectedHash = createHash("sha256").update(expected).digest();

  return timingSafeEqual(inputHash, expectedHash);
}
