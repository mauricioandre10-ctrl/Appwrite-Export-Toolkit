import fs from "node:fs/promises";
import { mkdirSync, accessSync } from "node:fs";
import path from "node:path";
import os from "node:os";

export type JobStatus = "pending" | "running" | "completed" | "failed";

export type JobProgress = {
  jobId: string;
  type: "import" | "export";
  status: JobStatus;
  percent: number;
  phase: string;
  module: string;
  detail: string;
  startedAt: string;
  finishedAt: string;
  result?: unknown;
  error?: string | undefined;
};

function resolveJobsDir(): string {
  const candidates = [
    process.env.BACKUP_OUTPUT_DIR,
    "/data",
    path.resolve(process.cwd(), ".data"),
    os.tmpdir(),
  ].filter((value): value is string => typeof value === "string" && value.length > 0);

  for (const candidate of candidates) {
    const resolved = path.resolve(candidate, ".jobs");
    try {
      mkdirSync(resolved, { recursive: true });
      accessSync(resolved);
      return resolved;
    } catch {
      // try next candidate
    }
  }

  return path.join(os.tmpdir(), ".jobs");
}

let cachedJobsDir: string | null = null;

async function getJobsDir(): Promise<string> {
  if (cachedJobsDir !== null) return cachedJobsDir;
  const dir = resolveJobsDir();
  await fs.mkdir(dir, { recursive: true });
  cachedJobsDir = dir;
  return dir;
}

let jobCounter = 0;

async function jobFilePath(jobId: string): Promise<string> {
  const dir = await getJobsDir();
  return path.join(dir, `${jobId}.json`);
}

async function writeJob(job: JobProgress): Promise<void> {
  const filePath = await jobFilePath(job.jobId);
  await fs.writeFile(filePath, JSON.stringify(job, null, 2), "utf-8");
}

export async function createJobId(type: "import" | "export"): Promise<string> {
  await getJobsDir();
  jobCounter += 1;
  const ts = new Date().toISOString().replaceAll(":", "-").replace(/\.\d{3}Z$/, "Z");
  return `${type}_${ts}_${jobCounter}`;
}

export async function createJob(jobId: string, type: "import" | "export"): Promise<JobProgress> {
  const job: JobProgress = {
    jobId,
    type,
    status: "pending",
    percent: 0,
    phase: "initializing",
    module: "",
    detail: "",
    startedAt: new Date().toISOString(),
    finishedAt: "",
  };
  await writeJob(job);
  return job;
}

export async function updateJob(jobId: string, updates: Partial<Omit<JobProgress, "jobId" | "type">>): Promise<void> {
  const job = await getJob(jobId);
  if (job === undefined) return;
  Object.assign(job, updates);
  await writeJob(job);
}

export async function completeJob(jobId: string, result?: unknown, error?: string): Promise<void> {
  const job = await getJob(jobId);
  if (job === undefined) return;
  job.status = error ? "failed" : "completed";
  job.percent = error ? job.percent : 100;
  job.finishedAt = new Date().toISOString();
  job.result = result;
  job.error = error;
  await writeJob(job);
}

export async function getJob(jobId: string): Promise<JobProgress | undefined> {
  try {
    const filePath = await jobFilePath(jobId);
    const data = await fs.readFile(filePath, "utf-8");
    return JSON.parse(data) as JobProgress;
  } catch {
    return undefined;
  }
}

export async function cleanupOldJobs(maxAgeMs = 3600000): Promise<number> {
  const dir = await getJobsDir();
  const files = await fs.readdir(dir);
  let cleaned = 0;
  const now = Date.now();

  for (const file of files) {
    if (!file.endsWith(".json")) continue;
    try {
      const data = await fs.readFile(path.join(dir, file), "utf-8");
      const job = JSON.parse(data) as JobProgress;
      const finished = job.finishedAt ? new Date(job.finishedAt).getTime() : new Date(job.startedAt).getTime();
      if (now - finished > maxAgeMs) {
        await fs.unlink(path.join(dir, file));
        cleaned += 1;
      }
    } catch {
      // ignore
    }
  }
  return cleaned;
}
