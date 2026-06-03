const currentJobs = new Map<string, string>();

export function setCurrentJob(scheduleId: string, jobId: string): void {
  currentJobs.set(scheduleId, jobId);
}

export function getCurrentJob(scheduleId: string): string | undefined {
  return currentJobs.get(scheduleId);
}

export function clearCurrentJob(scheduleId: string): void {
  currentJobs.delete(scheduleId);
}

export function listCurrentJobs(): Array<{ scheduleId: string; jobId: string }> {
  return Array.from(currentJobs.entries()).map(([scheduleId, jobId]) => ({ scheduleId, jobId }));
}
