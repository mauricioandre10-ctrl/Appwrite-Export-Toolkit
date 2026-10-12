/**
 * Tests para el borrado en lote de backups (deleteBackupBatch).
 * Cubre el borrado múltiple, la tolerancia a IDs inexistentes (los marca como
 * fallidos sin abortar el lote) y la protección contra path traversal.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { createBackupId } from "../backup/paths";
import { deleteBackupBatch } from "./delete-catalog";

function makeFakeBackup(outputDir: string, backupId: string): void {
  const backupDir = path.join(outputDir, backupId);
  mkdirSync(backupDir, { recursive: true });
  writeFileSync(
    path.join(backupDir, "manifest.json"),
    JSON.stringify({
      formatVersion: "1.0.0",
      exportedAt: new Date().toISOString(),
      endpoint: "https://example.test/v1",
      projectId: "test",
      modules: ["project", "auth"],
      counts: {},
      restoreOrder: ["auth"],
      warnings: [],
      checksums: {},
      moduleStatus: { auth: "complete" },
    }),
  );
}

describe("deleteBackupBatch", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(path.join(tmpdir(), "aet-del-batch-"));
  });

  afterEach(() => {
    if (existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("elimina todos los backups del lote", async () => {
    const id1 = createBackupId("test", new Date(Date.UTC(2026, 0, 1, 0, 1, 0)), "all");
    const id2 = createBackupId("test", new Date(Date.UTC(2026, 0, 1, 0, 2, 0)), "all");
    makeFakeBackup(tempDir, id1);
    makeFakeBackup(tempDir, id2);

    const result = await deleteBackupBatch(tempDir, [id1, id2]);

    expect(result.deleted).toEqual([id1, id2]);
    expect(result.failed).toEqual([]);
    expect(existsSync(path.join(tempDir, id1))).toBe(false);
    expect(existsSync(path.join(tempDir, id2))).toBe(false);
  });

  it("es idempotente: un ID seguro inexistente se cuenta como eliminado", async () => {
    const id1 = createBackupId("test", new Date(Date.UTC(2026, 0, 1, 0, 1, 0)), "all");
    makeFakeBackup(tempDir, id1);

    const result = await deleteBackupBatch(tempDir, [id1, "no-existe_2026-01-01T00-00-00Z_test"]);

    expect(result.deleted).toEqual([id1, "no-existe_2026-01-01T00-00-00Z_test"]);
    expect(result.failed).toEqual([]);
    expect(existsSync(path.join(tempDir, id1))).toBe(false);
  });

  it("rechaza IDs peligrosos (path traversal) marcándolos como fallidos", async () => {
    const result = await deleteBackupBatch(tempDir, ["../../outside"]);

    expect(result.deleted).toEqual([]);
    expect(result.failed).toEqual(["../../outside"]);
    expect(existsSync(path.join(tmpdir(), "aet-del-batch-marker"))).toBe(false);
  });

  it("retorna listas vacías si no se pide nada", async () => {
    const result = await deleteBackupBatch(tempDir, []);

    expect(result.deleted).toEqual([]);
    expect(result.failed).toEqual([]);
  });
});