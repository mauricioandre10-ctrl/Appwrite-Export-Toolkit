import { afterEach, describe, expect, it } from "vitest";

import { clearCurrentJob, getCurrentJob, listCurrentJobs, setCurrentJob } from "./running-jobs";

describe("running-jobs registry", () => {
  afterEach(() => {
    for (const { scheduleId } of listCurrentJobs()) {
      clearCurrentJob(scheduleId);
    }
  });

  it("stores and retrieves a jobId by scheduleId", () => {
    expect(getCurrentJob("sch_a")).toBeUndefined();
    setCurrentJob("sch_a", "job_1");
    expect(getCurrentJob("sch_a")).toBe("job_1");
    setCurrentJob("sch_b", "job_2");
    expect(getCurrentJob("sch_b")).toBe("job_2");
    expect(getCurrentJob("sch_a")).toBe("job_1");
  });

  it("overwrites previous jobId for the same schedule", () => {
    setCurrentJob("sch_x", "job_1");
    setCurrentJob("sch_x", "job_2");
    expect(getCurrentJob("sch_x")).toBe("job_2");
    expect(listCurrentJobs()).toHaveLength(1);
  });

  it("clears a jobId without touching others", () => {
    setCurrentJob("sch_a", "job_1");
    setCurrentJob("sch_b", "job_2");
    clearCurrentJob("sch_a");
    expect(getCurrentJob("sch_a")).toBeUndefined();
    expect(getCurrentJob("sch_b")).toBe("job_2");
  });

  it("returns an empty list when nothing is registered", () => {
    expect(listCurrentJobs()).toEqual([]);
  });
});
