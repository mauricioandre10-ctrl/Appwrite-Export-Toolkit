/**
 * Tests para la política de retención (pruneRetainedBackups).
 * Cubre el borrado automático de las copias más antiguas al superar el límite,
 * el límite 0 (retención desactivada) y la validación del argumento maxRetention.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { createBackupId } from "../backup/paths";
import { pruneRetainedBackups } from "./retention";

/** Crea un backup falso con manifest mínimo para que sea listable por listBackupSummaries. */
function makeFakeBackup(outputDir: string, backupId: string, exportedAt: string): void {
  const backupDir = path.join(outputDir, backupId);
  mkdirSync(backupDir, { recursive: true });
  writeFileSync(
    path.join(backupDir, "manifest.json"),
    JSON.stringify({
      formatVersion: "1.0.0",
      exportedAt,
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

describe("pruneRetainedBackups", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(path.join(tmpdir(), "aet-retention-"));
  });

  afterEach(() => {
    if (existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  /** Crea `count` backups con exportedAt updated; devuelve ids del más reciente al más antiguo. */
  function createBackups(count: number): string[] {
    const ids: string[] = [];
    for (let i = 0; i < count; i++) {
      // minuto = count - i: el primero generado es el más reciente.
      const date = new Date(Date.UTC(2026, 0, 1, 0, count - i, 0));
      const backupId = createBackupId("test", date, "all");
      makeFakeBackup(tempDir, backupId, date.toISOString());
      ids.push(backupId);
    }
    return ids;
  }

  it("conserva las 5 más recientes y elimina las más antiguas", async () => {
    const idsNewestToOldest = createBackups(8);

    const result = await pruneRetainedBackups(tempDir, 5);

    expect(result.removed).toEqual(idsNewestToOldest.slice(5));
    expect(result.kept).toEqual(idsNewestToOldest.slice(0, 5));

    for (const removedId of result.removed) {
      expect(existsSync(path.join(tempDir, removedId))).toBe(false);
    }
    for (const keptId of result.kept) {
      expect(existsSync(path.join(tempDir, keptId))).toBe(true);
    }
  });

  it("no elimina nada cuando hay menos backups que el límite", async () => {
    createBackups(3);

    const result = await pruneRetainedBackups(tempDir, 5);

    expect(result.removed).toEqual([]);
    expect(result.kept).toHaveLength(3);
  });

  it("con maxRetention 0 la retención está desactivada", async () => {
    createBackups(7);

    const result = await pruneRetainedBackups(tempDir, 0);

    expect(result.removed).toEqual([]);
    expect(result.kept).toEqual([]);
  });

  it("lanza error si maxRetention es negativo", async () => {
    await expect(pruneRetainedBackups(tempDir, -1)).rejects.toThrow("maxRetention must be a non-negative integer");
  });

  it("lanza error si maxRetention no es un entero", async () => {
    await expect(pruneRetainedBackups(tempDir, 2.5)).rejects.toThrow("maxRetention must be a non-negative integer");
  });
});