import Link from "next/link";
import Image from "next/image";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { loadAppwriteConfig } from "@/server/appwrite/config";
import type { BackupSummary } from "@/server/backups/catalog";
import { LoginSubmitButton } from "./loading-button";
import { listBackupSummaries, resolveManagedBackupPath } from "@/server/backups/catalog";
import { validateBackup } from "@/server/validators/backup-validator";
import { deleteBackup, getBackupDeletionInfo, formatBytes } from "@/server/backups/delete-catalog";
import { ExportPanel } from "@/components/export-panel";
import { ImportPanel } from "@/components/import-panel";
import { SchedulesPanel } from "@/components/schedules-panel";
import { BackupWarnings } from "@/components/backup-warnings";
import { PasswordInput } from "./password-input";
import { CsrfTokenInput } from "./csrf-token";
import { sessionCookieName, getLoginConfig, createSessionToken, safeEqual, isValidSessionToken } from "@/server/auth/session";
import { validateCsrfToken, getCsrfToken } from "@/server/auth/csrf";

/** Limpia mensajes de error para evitar filtrar paths del sistema al usuario. */
function sanitizeErrorMessage(error: unknown, fallback: string): string {
  if (!(error instanceof Error)) {
    return fallback;
  }
  const msg = error.message;
  if (msg.includes("/") || msg.includes("\\") || msg.includes("ENOENT") || msg.includes("EACCES")) {
    return fallback;
  }
  return msg.slice(0, 80).replaceAll(" ", "_");
}

/** Valida el token CSRF del form y redirige si es invalido. */
async function requireCsrf(formData: FormData): Promise<void> {
  const token = formData.get("csrf_token");
  if (!(await validateCsrfToken(typeof token === "string" ? token : null))) {
    redirect("/?error=csrf_invalid");
  }
}

type PageProps = {
  searchParams?: Promise<{
    error?: string;
    loggedOut?: string;
    exported?: string;
    exportModule?: string;
    imported?: string;
    importModule?: string;
    importStatus?: string;
    validated?: string;
    validationErrors?: string;
    validationWarnings?: string;
    actionError?: string;
    tab?: string;
    deleteConfirm?: string;
    deleted?: string;
  }>;
};

/** Pagina principal: muestra login si no autenticado, o el dashboard completo. */
export default async function Home({ searchParams }: PageProps) {
  const loginConfig = getLoginConfig();
  const cookieStore = await cookies();
  const sessionCookie = cookieStore.get(sessionCookieName)?.value;
  const isAuthenticated = isValidSessionToken(sessionCookie);
  const params = await searchParams;

  // Generate CSRF token for forms (stateless: HMAC of session + timestamp)
  const csrfToken = await getCsrfToken();

  if (isAuthenticated) {
    const dashboardData = await getDashboardData();

    return (
      <DashboardShell
        backups={dashboardData.backups}
        outputDir={dashboardData.outputDir}
        configError={dashboardData.configError}
        params={params}
        csrfToken={csrfToken}
      />
    );
  }

  return (
    <main className="min-h-screen overflow-hidden bg-[#071015] text-slate-50">
      <meta name="csrf-token" content={csrfToken ?? ""} />
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
              csrfToken={csrfToken}
            />
          </div>
        </section>

        <Footer />
      </div>
    </main>
  );
}

/** Shell principal del dashboard autenticado con tabs, alertas y contenido dinamico. */
function DashboardShell({
  backups,
  outputDir,
  configError,
  params,
  csrfToken,
}: {
  backups: BackupSummary[];
  outputDir: string;
  configError: string | null;
  params?: Awaited<PageProps["searchParams"]>;
  csrfToken?: string | null | undefined;
}) {
  const latest = backups[0];
  const activeTab: "export" | "import" | "schedules" =
    params?.tab === "import" ? "import" : params?.tab === "schedules" ? "schedules" : "export";

  return (
    <main className="min-h-screen bg-[#071015] text-slate-50">
      <meta name="csrf-token" content={csrfToken ?? ""} />
      <BackgroundGlow />
      <div className="relative mx-auto flex min-h-screen w-full max-w-7xl flex-col px-4 py-5 sm:px-6 lg:px-8">
        <header className="flex flex-col gap-4 rounded-[1.75rem] border border-white/10 bg-white/[0.06] p-4 backdrop-blur-xl sm:flex-row sm:items-center sm:justify-between">
          <BrandHeader compact />
          <div className="flex flex-wrap items-center gap-3">
            <span className="rounded-full border border-emerald-300/20 bg-emerald-300/10 px-4 py-2 text-xs font-semibold text-emerald-100">
              {outputDir}
            </span>
            <form action={logoutAction}>
              <CsrfTokenInput token={csrfToken} />
              <button className="rounded-full border border-white/10 px-4 py-2 text-sm font-semibold text-white transition hover:bg-white/10">
                Cerrar sesion
              </button>
            </form>
          </div>
        </header>

        <AppBar activeTab={activeTab} />

        <AlertPanel params={params} configError={configError} />

        {activeTab === "import" ? (
          <ImportSection backups={backups} configError={configError} params={params} />
        ) : activeTab === "schedules" ? (
          <SchedulesSection />
        ) : (
          <ExportSection backups={backups} latest={latest} configError={configError} csrfToken={csrfToken} />
        )}

        {params?.deleteConfirm !== undefined ? (
          <DeleteConfirmModal backupId={params.deleteConfirm} csrfToken={csrfToken} />
        ) : null}

        {params?.deleted !== undefined ? (
          <PanelAlert tone="success" title="Backup eliminado" message={`Backup ${params.deleted} eliminado correctamente.`} />
        ) : null}

        <Footer />
      </div>
    </main>
  );
}

/** Barra de navegacion por tabs: Export, Schedules e Import. */
function AppBar({ activeTab }: { activeTab: "export" | "import" | "schedules" }) {
  return (
    <nav className="mt-5 flex gap-1 rounded-2xl border border-white/10 bg-white/[0.04] p-1">
      <Link
        href="/?tab=export"
        className={`flex-1 rounded-xl px-5 py-3 text-center text-sm font-bold transition ${
          activeTab === "export"
            ? "bg-emerald-300 text-slate-950"
            : "text-slate-300 hover:bg-white/10"
        }`}
      >
        <span className="flex items-center justify-center gap-2">
          <ExportIcon /> Export
        </span>
      </Link>
      <Link
        href="/?tab=schedules"
        className={`flex-1 rounded-xl px-5 py-3 text-center text-sm font-bold transition ${
          activeTab === "schedules"
            ? "bg-violet-300 text-slate-950"
            : "text-slate-300 hover:bg-white/10"
        }`}
      >
        <span className="flex items-center justify-center gap-2">
          <ScheduleIcon /> Schedules
        </span>
      </Link>
      <Link
        href="/?tab=import"
        className={`flex-1 rounded-xl px-5 py-3 text-center text-sm font-bold transition ${
          activeTab === "import"
            ? "bg-sky-300 text-slate-950"
            : "text-slate-300 hover:bg-white/10"
        }`}
      >
        <span className="flex items-center justify-center gap-2">
          <ImportIcon /> Import
        </span>
      </Link>
    </nav>
  );
}

/** Wrapper del panel de programacion de backups. */
function SchedulesSection() {
  return <SchedulesPanel />;
}

/** Seccion de exportacion: metricas del ultimo backup, panel de export y historial. */
function ExportSection({
  backups,
  latest,
  configError,
  csrfToken,
}: {
  backups: BackupSummary[];
  latest: BackupSummary | undefined;
  configError: string | null;
  params?: Awaited<PageProps["searchParams"]>;
  csrfToken?: string | null | undefined;
}) {
  const totalFiles = latest?.counts.files ?? 0;
  const totalDocuments = latest?.counts.documents ?? 0;
  const totalChecksums = latest?.checksums ?? 0;

  return (
    <>
      <section className="grid gap-5 py-6 lg:grid-cols-[1.1fr_0.9fr]">
        <div className="rounded-[2rem] border border-white/10 bg-slate-950/50 p-6 shadow-2xl shadow-black/20">
          <div>
            <p className="text-sm font-semibold tracking-[0.24em] text-emerald-200 uppercase">
              Centro de control
            </p>
            <h1 className="mt-3 max-w-lg text-3xl font-black leading-tight tracking-tight text-white sm:text-4xl lg:text-5xl">
              Exports Appwrite listos para volumen persistente.
            </h1>
            <p className="mt-3 max-w-lg text-sm leading-6 text-slate-300 sm:text-base">
              Lanza backups por modulo, valida integridad y revisa estado por recurso sin salir del panel.
            </p>
            <StatusPill status={Object.values(latest?.moduleStatus ?? {}).some(s => s !== "complete") ? "partial" : "complete"} />
          </div>

          <div className="mt-8 grid gap-3 sm:grid-cols-3">
            <DashboardMetric label="Backups" value={String(backups.length)} tone="emerald" />
            <DashboardMetric label="Documentos" value={String(totalDocuments)} tone="blue" />
            <DashboardMetric label="Archivos" value={String(totalFiles)} tone="violet" />
          </div>

          <div className="mt-3 grid gap-3 sm:grid-cols-3">
            <DashboardMetric label="Checksums" value={String(totalChecksums)} tone="amber" />
            <DashboardMetric label="Databases" value={latest?.moduleStatus.databases ?? "sin datos"} tone="slate" />
            <DashboardMetric label="Storage" value={latest?.moduleStatus.storage ?? "sin datos"} tone="slate" />
          </div>
        </div>

        <ExportPanel configError={configError} />
      </section>

      <section className="grid gap-5 pb-8 lg:grid-cols-[0.95fr_1.05fr]">
        <LatestBackupCard backup={latest} csrfToken={csrfToken} />
        <BackupHistory backups={backups} csrfToken={csrfToken} />
      </section>
    </>
  );
}

/** Seccion de importacion: panel de restauracion y resultado del import. */
function ImportSection({
  backups,
  configError,
  params,
}: {
  backups: BackupSummary[];
  configError: string | null;
  params?: Awaited<PageProps["searchParams"]>;
}) {
  return (
    <>
      <section className="grid gap-5 py-6 lg:grid-cols-[1.1fr_0.9fr]">
        <div className="rounded-[2rem] border border-white/10 bg-slate-950/50 p-6 shadow-2xl shadow-black/20">
          <div>
            <p className="text-sm font-semibold tracking-[0.24em] text-sky-200 uppercase">
              Restore / Import
            </p>
            <h1 className="mt-3 max-w-lg text-3xl font-black leading-tight tracking-tight text-white sm:text-4xl lg:text-5xl">
              Importa backups a otro Appwrite.
            </h1>
            <p className="mt-3 max-w-lg text-sm leading-6 text-slate-300 sm:text-base">
              Selecciona un backup y los modulos a restaurar. Los IDs se remapean automaticamente.
            </p>
            <div className="mt-4 inline-block rounded-full bg-sky-300/20 px-4 py-2 text-sm font-bold text-sky-200">
              Restore order: auth → messaging → databases → storage → functions
            </div>
          </div>

          <div className="mt-8 grid gap-3 sm:grid-cols-3">
            <DashboardMetric label="Modulos" value="3" tone="sky" />
            <DashboardMetric label="Orden" value="Secuencial" tone="blue" />
            <DashboardMetric label="Remapeo" value="Auto" tone="emerald" />
          </div>
        </div>

        <ImportPanel backups={backups} configError={configError} />
      </section>

      {params?.imported !== undefined ? (
        <ImportResultAlert params={params} />
      ) : null}
    </>
  );
}

/** Muestra el resultado de un import con tono segun el estado (success, partial, failed). */
function ImportResultAlert({ params }: { params: Awaited<PageProps["searchParams"]> }) {
  const status = params?.importStatus ?? "complete";
  const tone = status === "failed" ? "error" : status === "partial" ? "warning" : "success";

  return (
    <div className={`mb-6 rounded-[1.5rem] border p-4 ${
      tone === "success" ? "border-emerald-300/20 bg-emerald-300/10 text-emerald-100" :
      tone === "warning" ? "border-amber-300/20 bg-amber-300/10 text-amber-100" :
      "border-red-300/20 bg-red-300/10 text-red-100"
    }`}>
      <p className="font-bold">Import {status}</p>
      <p className="mt-1 text-sm opacity-85">
        Backup {params?.imported} importado al modulo {params?.importModule ?? "all"}.
      </p>
    </div>
  );
}

/** Panel de alertas contextual: errores de config, export completado, validacion, etc. */
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

/** Tarjeta del ultimo backup: metricas por modulo, logs recientes y acciones de validacion/descarga. */
function LatestBackupCard({ backup, csrfToken }: { backup: BackupSummary | undefined; csrfToken?: string | null | undefined }) {
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
              <SimpleProgressBar percent={status === "complete" ? 100 : status === "partial" ? 65 : 0} size="sm" />
            </div>
          </div>
        ))}
      </div>

      <div className="mt-5">
        <SimpleProgressBar percent={backup.progress} />
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
          <CsrfTokenInput token={csrfToken} />
          <input name="backupId" type="hidden" value={backup.backupId} />
          <SubmitButton label="Validar" icon="check" />
        </form>
        <form
          method="POST"
          action={`/api/backups/${encodeURIComponent(backup.backupId)}/download`}
          className="flex-1"
        >
          <CsrfTokenInput token={csrfToken} />
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

/** Lista historial de backups con acciones de descargar, validar y eliminar por cada uno. */
function BackupHistory({ backups, csrfToken }: { backups: BackupSummary[]; csrfToken?: string | null | undefined }) {
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
                  <CsrfTokenInput token={csrfToken} />
                  <button
                    type="submit"
                    className="inline-flex items-center gap-1.5 rounded-full border border-emerald-300/30 bg-emerald-300/10 px-3 py-2 text-xs font-bold text-emerald-200 transition hover:bg-emerald-300/20"
                  >
                    <DownloadIcon /> Descargar
                  </button>
                </form>
                <form action={validateAction}>
                  <CsrfTokenInput token={csrfToken} />
                  <input name="backupId" type="hidden" value={backup.backupId} />
                  <SubmitButton label="Validar" icon="check" compact />
                </form>
                <form action={deleteConfirmAction}>
                  <CsrfTokenInput token={csrfToken} />
                  <input name="backupId" type="hidden" value={backup.backupId} />
                  <button
                    type="submit"
                    className="inline-flex items-center gap-1.5 rounded-full border border-red-300/30 bg-red-300/10 px-3 py-2 text-xs font-bold text-red-200 transition hover:bg-red-300/20"
                  >
                    <TrashIcon /> Eliminar
                  </button>
                </form>
              </div>
            </div>
            <div className="mt-3">
              <SimpleProgressBar percent={backup.progress} size="sm" />
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              <MiniChip label={`docs ${backup.counts.documents ?? 0}`} />
              <MiniChip label={`files ${backup.counts.files ?? 0}`} />
              <MiniChip label={`sha ${backup.checksums}`} />
              <BackupWarnings count={backup.warnings} messages={backup.warningMessages} backupId={backup.backupId} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Panel de login con campos de usuario/password y mensajes de estado. */
function LoginPanel({
  action,
  configReady,
  hasError,
  loggedOut,
  csrfToken,
}: {
  action: (formData: FormData) => Promise<void>;
  configReady: boolean;
  hasError: boolean;
  loggedOut: boolean;
  csrfToken?: string | null | undefined;
}) {
  return (
    <div>
      <p className="text-sm font-semibold tracking-[0.24em] text-emerald-200 uppercase">Acceso privado</p>
      <h2 className="mt-3 text-3xl font-black text-white">Iniciar sesion</h2>

      {!configReady ? <InlineNotice tone="warning" message="Configura APP_LOGIN_USER y APP_LOGIN_PASSWORD." /> : null}
      {hasError ? <InlineNotice tone="error" message="Usuario o password incorrectos." /> : null}
      {loggedOut ? <InlineNotice tone="success" message="Sesion cerrada correctamente." /> : null}

      <form action={action} className="mt-7 space-y-5">
        <CsrfTokenInput token={csrfToken} />
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

        <PasswordInput />

        <LoginSubmitButton configReady={configReady} />
      </form>
    </div>
  );
}

/** Chip pequeno con texto clickeable para mostrar metricas compactas. */
function MiniChip({ label, onClick }: { label: string; onClick?: () => void }) {
  return (
    <span 
      className="rounded-full bg-white/10 px-3 py-1 text-xs text-slate-300 cursor-pointer hover:bg-white/20"
      onClick={onClick}
    >
      {label}
    </span>
  );
}

/** Barra de progreso simple con color dinamico segun el porcentaje. */
function SimpleProgressBar({ percent, size = "md" }: { percent: number; size?: "sm" | "md" }) {
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

/** Fila de log individual con timestamp, nivel de severidad y mensaje. */
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

/** Icono SVG de exportacion (flecha hacia arriba). */
function ExportIcon() {
  return (
    <svg className="size-4" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M8 2v9M4.5 7.5 8 11l3.5-3.5M3 13h10" />
    </svg>
  );
}

/** Icono SVG de importacion (flecha hacia abajo). */
function ImportIcon() {
  return (
    <svg className="size-4" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M8 14V5M4.5 8.5 8 5l3.5 3.5M3 3h10" />
    </svg>
  );
}

/** Icono SVG de reloj para programacion de backups. */
function ScheduleIcon() {
  return (
    <svg className="size-4" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="8" cy="9" r="6" />
      <path d="M8 6v3l2 1.5M5 2v2M11 2v2" />
    </svg>
  );
}

/** Icono SVG de descarga. */
function DownloadIcon() {
  return (
    <svg className="size-3.5" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M8 2v9M4.5 7.5 8 11l3.5-3.5M3 13h10" />
    </svg>
  );
}

/** Icono SVG de papelera para eliminar. */
function TrashIcon() {
  return (
    <svg className="size-3.5" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2 4h12M5.333 4V2.667a1.333 1.333 0 0 1 1.334-1.334h2.666a1.333 1.333 0 0 1 1.334 1.334V4m2 0v9.333a1.333 1.333 0 0 1-1.334 1.334H4.667a1.333 1.333 0 0 1-1.334-1.334V4h9.334Z" />
    </svg>
  );
}

/** Boton de envio generico con icono opcional y variante compacta. */
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

/** Formatea un timestamp ISO a hora legible en formato 24h. */
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

/** Glow decorativo de fondo con gradientes radiales. */
function BackgroundGlow() {
  return (
    <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(circle_at_top_left,#23d3a640,transparent_34%),radial-gradient(circle_at_bottom_right,#4f46e540,transparent_34%)]" />
  );
}

/** Header de marca con logo y nombre del toolkit, en variante compacta o completa. */
function BrandHeader({ compact = false }: { compact?: boolean }) {
  return (
    <div className="flex items-center gap-3 sm:gap-4">
      <Image
        src="/logo_aet2_512x512.webp"
        alt="Appwrite Export Toolkit"
        width={56}
        height={56}
        className="size-11 rounded-xl object-cover sm:size-12 lg:size-14"
      />
      <div className="min-w-0">
        <p className="text-sm font-semibold tracking-[0.28em] text-emerald-200/80 uppercase sm:text-base lg:text-lg">
          Appwrite Export Toolkit
        </p>
        <p className="truncate text-xs text-slate-400 sm:text-sm">
          {compact ? "Panel operativo" : "Backup logico, validacion y restore controlado"}
        </p>
      </div>
    </div>
  );
}

/** Copy principal de la landing: titulo, subtitulo e imagen del hero. */
function HeroCopy() {
  return (
    <div className="max-w-2xl">
      <Image
        src="/logo_aet.webp"
        alt="Appwrite Export Toolkit"
        width={256}
        height={256}
        className="mb-8 w-48 rounded-2xl object-cover shadow-2xl shadow-black/40 sm:w-56 lg:w-64"
      />
      <h1 className="text-4xl font-black tracking-tight text-white sm:text-6xl">
        Controla tus backups Appwrite sin depender del servidor fisico.
      </h1>
      <p className="mt-6 max-w-xl text-lg leading-8 text-slate-300">
        Exporta Auth, Databases, Storage en archivos estructurados,
        verificables y listos para migracion entre instancias.
      </p>
    </div>
  );
}

/** Tarjeta de metrica individual con tono de color configurable. */
function DashboardMetric({ label, value, tone }: { label: string; value: string; tone: string }) {
  const toneClass = {
    emerald: "border-emerald-300/20 bg-emerald-300/10 text-emerald-100",
    blue: "border-sky-300/20 bg-sky-300/10 text-sky-100",
    violet: "border-violet-300/20 bg-violet-300/10 text-violet-100",
    amber: "border-amber-300/20 bg-amber-300/10 text-amber-100",
    rose: "border-rose-300/20 bg-rose-300/10 text-rose-100",
    sky: "border-sky-300/20 bg-sky-300/10 text-sky-100",
    slate: "border-white/10 bg-white/[0.06] text-slate-100",
  }[tone] ?? "border-white/10 bg-white/[0.06] text-slate-100";

  return (
    <div className={`rounded-2xl border p-4 ${toneClass}`}>
      <p className="truncate text-2xl font-black">{value}</p>
      <p className="mt-1 text-xs tracking-[0.2em] opacity-70 uppercase">{label}</p>
    </div>
  );
}

/** Pill indicador de estado del export (completo o parcial). */
function StatusPill({ status }: { status: "complete" | "partial" }) {
  return (
    <div className={`rounded-full px-4 py-2 text-sm font-bold ${status === "complete" ? "bg-emerald-300 text-slate-950" : "bg-amber-300 text-slate-950"}`}>
      {status === "complete" ? "Export completo" : "Export parcial"}
    </div>
  );
}

/** Alerta de panel con titulo y mensaje, en tono success o error. */
function PanelAlert({ tone, title, message }: { tone: "success" | "error"; title: string; message: string }) {
  const toneClass = tone === "success" ? "border-emerald-300/20 bg-emerald-300/10 text-emerald-100" : "border-red-300/20 bg-red-300/10 text-red-100";

  return (
    <div className={`mb-6 rounded-[1.5rem] border p-4 ${toneClass}`}>
      <p className="font-bold">{title}</p>
      <p className="mt-1 text-sm opacity-85">{message}</p>
    </div>
  );
}

/** Notificacion inline con tono success, warning o error. */
function InlineNotice({ tone, message }: { tone: "success" | "warning" | "error"; message: string }) {
  const toneClass = {
    success: "border-emerald-300/30 bg-emerald-300/10 text-emerald-100",
    warning: "border-amber-300/30 bg-amber-300/10 text-amber-100",
    error: "border-red-300/30 bg-red-400/10 text-red-100",
  }[tone];

  return <div className={`mt-6 rounded-2xl border p-4 text-sm ${toneClass}`}>{message}</div>;
}

/** Modal de confirmacion de eliminacion de backup con info detallada y acciones. */
async function DeleteConfirmModal({ backupId, csrfToken }: { backupId: string; csrfToken?: string | null | undefined }) {
  let info;
  try {
    const config = loadAppwriteConfig();
    info = await getBackupDeletionInfo(config.BACKUP_OUTPUT_DIR, backupId);
  } catch {
    return <PanelAlert tone="error" title="Error" message={`No se encontro el backup ${backupId}.`} />;
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
      <div className="mx-4 w-full max-w-lg rounded-[2rem] border border-red-300/30 bg-slate-950 p-8 shadow-2xl shadow-red-900/30">
        <div className="flex items-center gap-3">
          <div className="grid size-10 place-items-center rounded-full bg-red-400/20">
            <TrashIcon />
          </div>
          <div>
            <p className="text-sm font-semibold tracking-[0.24em] text-red-200 uppercase">Eliminar backup</p>
            <p className="text-xs text-slate-400">Esta accion no se puede deshacer</p>
          </div>
        </div>

        <div className="mt-6 space-y-3 rounded-2xl border border-white/10 bg-white/[0.04] p-5">
          <div className="flex justify-between text-sm">
            <span className="text-slate-400">Backup</span>
            <span className="font-mono text-white">{info.backupId}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-slate-400">Fecha</span>
            <span className="text-white">{new Date(info.exportedAt).toLocaleString("es-ES")}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-slate-400">Proyecto</span>
            <span className="font-mono text-white">{info.projectId}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-slate-400">Modulos</span>
            <span className="text-white">{info.modules.join(", ")}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-slate-400">Archivos</span>
            <span className="text-white">{info.fileCount}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-slate-400">Tamano</span>
            <span className="font-bold text-red-200">{formatBytes(info.totalSizeBytes)}</span>
          </div>
        </div>

        <p className="mt-4 text-sm text-red-300/80">
          Se eliminaran permanentemente <strong>{info.fileCount} archivos</strong> ({formatBytes(info.totalSizeBytes)}).
        </p>

        <div className="mt-6 flex flex-col gap-3 sm:flex-row">
          <Link
            href="/"
            className="flex-1 rounded-2xl border border-white/10 bg-white/5 px-5 py-3 text-center text-sm font-bold text-white transition hover:bg-white/10"
          >
            Cancelar
          </Link>
          <form action={deleteAction} className="flex-1">
            <CsrfTokenInput token={csrfToken} />
            <input name="backupId" type="hidden" value={backupId} />
            <button
              type="submit"
              className="flex h-12 w-full items-center justify-center gap-2 rounded-2xl border border-red-300/40 bg-red-400/20 px-5 font-bold text-red-200 transition hover:bg-red-400/30"
            >
              <TrashIcon /> Eliminar permanentemente
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}

/** Formatea una fecha ISO a formato local en espanol. */
function formatDate(value: string): string {
  return new Intl.DateTimeFormat("es", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

/** Obtiene los datos del dashboard: lista de backups, directorio y errores de config. */
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
      configError: sanitizeErrorMessage(error, "Configuracion invalida."),
    };
  }
}

/** Server action: ejecuta validacion de integridad sobre un backup y redirige con resultado. */
async function validateAction(formData: FormData) {
  "use server";

  await requireAuthenticated();
  await requireCsrf(formData);

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
    const reason = sanitizeErrorMessage(error, "validate_failed");
    redirect(`/?actionError=${encodeURIComponent(reason)}`);
  }

  redirect(
    `/?validated=${encodeURIComponent(backupId)}&validationErrors=${errors}&validationWarnings=${warnings}`,
  );
}

/** Server action: redirige al modal de confirmacion de eliminacion. */
async function deleteConfirmAction(formData: FormData) {
  "use server";

  await requireAuthenticated();
  await requireCsrf(formData);

  const backupId = String(formData.get("backupId") ?? "");
  redirect(`/?deleteConfirm=${encodeURIComponent(backupId)}`);
}

/** Server action: elimina un backup del disco y redirige con confirmacion. */
async function deleteAction(formData: FormData) {
  "use server";

  await requireAuthenticated();
  await requireCsrf(formData);

  const backupId = String(formData.get("backupId") ?? "");

  try {
    const config = loadAppwriteConfig();
    await deleteBackup(config.BACKUP_OUTPUT_DIR, backupId);
  } catch (error) {
    const reason = sanitizeErrorMessage(error, "delete_failed");
    redirect(`/?actionError=${encodeURIComponent(reason)}`);
  }

  redirect(`/?deleted=${encodeURIComponent(backupId)}`);
}

/** Server action: autentica al usuario y crea la cookie de sesion. */
async function loginAction(formData: FormData) {
  "use server";

  const loginConfig = getLoginConfig();
  const user = String(formData.get("user") ?? "");
  const password = String(formData.get("password") ?? "");

  // CSRF not required for login (first form submission)
  if (!loginConfig.ready || !safeEqual(user, loginConfig.user) || !safeEqual(password, loginConfig.password)) {
    redirect("/?error=invalid");
  }

  const cookieStore = await cookies();
  const isSecure = process.env.NODE_ENV === "production" || process.env.COOKIE_SECURE === "1";
  cookieStore.set(sessionCookieName, createSessionToken(loginConfig.user, loginConfig.password), {
    httpOnly: true,
    sameSite: "lax",
    secure: isSecure,
    path: "/",
    maxAge: 60 * 60 * 8,
  });

  redirect("/");
}

/** Server action: cierra la sesion eliminando la cookie y redirige al login. */
async function logoutAction(formData: FormData) {
  "use server";

  await requireCsrf(formData);

  const cookieStore = await cookies();
  cookieStore.delete(sessionCookieName);
  redirect("/?loggedOut=1");
}

/** Verifica que haya una sesion activa, redirige al login si no la hay. */
async function requireAuthenticated(): Promise<void> {
  const cookieStore = await cookies();
  const sessionCookie = cookieStore.get(sessionCookieName)?.value;

  if (!isValidSessionToken(sessionCookie)) {
    redirect("/?error=invalid");
  }
}

/** Footer de la app con info de licencia y autor. */
function Footer() {
  return (
    <footer className="mt-auto border-t border-white/10 pt-6 pb-4">
      <div className="flex flex-col items-center justify-center gap-2 text-center text-sm text-slate-500">
        <p>
          Software puramente educativo. Creado por{" "}
          <span className="font-semibold text-slate-400">Mauricio Sanchez</span>
        </p>
        <p className="flex items-center gap-1.5">
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="size-4">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 21a9.004 9.004 0 0 0 8.716-6.747M12 21a9.004 9.004 0 0 1-8.716-6.747M12 21c2.485 0 4.5-4.03 4.5-9S14.485 3 12 3m0 18c-2.485 0-4.5-4.03-4.5-9S9.515 3 12 3m0 0a8.997 8.997 0 0 1 7.843 4.582M12 3a8.997 8.997 0 0 0-7.843 4.582m15.686 0A11.953 11.953 0 0 1 12 10.5c-2.998 0-5.74-1.1-7.843-2.918m15.686 0A8.959 8.959 0 0 1 21 12c0 .778-.099 1.533-.284 2.253m0 0A17.919 17.919 0 0 1 12 16.5c-3.162 0-6.133-.815-8.716-2.247m0 0A9.015 9.015 0 0 1 3 12c0-1.605.42-3.113 1.157-4.418" />
          </svg>
          Licencia GNU GPLv3 · Código abierto
        </p>
      </div>
    </footer>
  );
}
