import { describe, it, expect, vi, beforeEach } from "vitest";
import { importDatabases } from "./database-importer";
import type { IdRemapper } from "../id-remapper";
import type { AppwriteServices } from "../../appwrite/client";

vi.mock("node:fs/promises", () => ({
  readFile: vi.fn(),
  readdir: vi.fn(),
  stat: vi.fn(),
}));

describe("database-importer", () => {
  let remapper: IdRemapper;
  let services: AppwriteServices;
  let readdirMock: ReturnType<typeof vi.fn>;
  let readFileMock: ReturnType<typeof vi.fn>;
  let statMock: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    vi.clearAllMocks();
    const fs = await import("node:fs/promises");
    readdirMock = vi.mocked(fs.readdir);
    readFileMock = vi.mocked(fs.readFile);
    statMock = vi.mocked(fs.stat);

    remapper = {
      addMapping: vi.fn(),
      getDestination: vi.fn((_, id) => id),
      save: vi.fn(),
      load: vi.fn(),
      getMapping: vi.fn(),
    } as unknown as IdRemapper;

    services = {
      databases: {
        get: vi.fn().mockRejectedValue(new Error("not found")),
        create: vi.fn().mockResolvedValue({ $id: "db1" }),
        getCollection: vi.fn().mockRejectedValue(new Error("not found")),
        createCollection: vi.fn().mockResolvedValue({ $id: "coll1" }),
        getDocument: vi.fn().mockRejectedValue(new Error("not found")),
        createDocument: vi.fn().mockResolvedValue({ $id: "doc1" }),
        listAttributes: vi.fn().mockResolvedValue({ total: 0, rows: [] }),
        listIndexes: vi.fn().mockResolvedValue({ total: 0, rows: [] }),
        createStringAttribute: vi.fn().mockResolvedValue({}),
        createBooleanAttribute: vi.fn().mockResolvedValue({}),
        createIndex: vi.fn().mockResolvedValue({}),
        getAttribute: vi.fn().mockResolvedValue({ status: "available" }),
      },
    } as unknown as AppwriteServices;
  });

  it("should read collection_<id>.ndjson (new format)", async () => {
    readdirMock.mockImplementation(async (p: unknown) => {
      const path = String(p);
      if (path.endsWith("databases")) return ["db_test123"];
      if (path.endsWith("db_test123")) return ["collection_profiles.ndjson", "meta.json"];
      return [];
    });

    statMock.mockImplementation(async () => ({ isFile: () => true, isDirectory: () => false }));

    readFileMock.mockImplementation(async (p: unknown) => {
      const path = String(p);
      if (path.endsWith("schema.json")) {
        return JSON.stringify({
          databases: [{
            database: { $id: "test123", name: "TestDB" },
            collections: [{
              collection: { $id: "profiles", name: "profiles", $permissions: ["read(\"users\")"] },
              attributes: [{ key: "name", type: "string", size: 256, required: false }],
              indexes: [],
            }],
          }],
        });
      }
      if (path.endsWith("collection_profiles.ndjson")) {
        return '{"$id":"doc1","name":"John"}\n{"$id":"doc2","name":"Jane"}\n';
      }
      return "{}";
    });

    const result = await importDatabases(services, "/tmp/backup", remapper);

    expect(services.databases.create).toHaveBeenCalledWith({ databaseId: "test123", name: "TestDB" });
    expect(services.databases.createCollection).toHaveBeenCalledWith({
      databaseId: "test123",
      collectionId: "profiles",
      name: "profiles",
      permissions: ["read(\"users\")"],
    });
    expect(services.databases.createDocument).toHaveBeenCalledTimes(2);
    expect(result.created).toBeGreaterThanOrEqual(3);
    expect(result.errors).toHaveLength(0);
  });

  it("should read coll_<id>/documents.ndjson (old format)", async () => {
    readdirMock.mockImplementation(async (p: unknown) => {
      const path = String(p);
      if (path.endsWith("databases")) return ["db_test123"];
      if (path.endsWith("db_test123")) return ["coll_profiles"];
      if (path.endsWith("coll_profiles")) return ["documents.ndjson"];
      return [];
    });

    statMock.mockImplementation(async () => { throw new Error("not found"); });

    readFileMock.mockImplementation(async (p: unknown) => {
      const path = String(p);
      if (path.endsWith("schema.json")) {
        return JSON.stringify({
          databases: [{
            database: { $id: "test123", name: "TestDB" },
            collections: [{
              collection: { $id: "profiles", name: "profiles", $permissions: [] },
              attributes: [],
              indexes: [],
            }],
          }],
        });
      }
      if (path.endsWith("documents.ndjson")) {
        return '{"$id":"doc1","name":"John"}\n';
      }
      return "{}";
    });

    const result = await importDatabases(services, "/tmp/backup", remapper);

    expect(services.databases.createDocument).toHaveBeenCalledTimes(1);
    expect(result.created).toBeGreaterThanOrEqual(2);
    expect(result.errors).toHaveLength(0);
  });

  it("should use schema.json for DB name when no database.json exists", async () => {
    readdirMock.mockImplementation(async (p: unknown) => {
      const path = String(p);
      if (path.endsWith("databases")) return ["db_test123"];
      return [];
    });

    statMock.mockImplementation(async () => { throw new Error("not found"); });

    readFileMock.mockImplementation(async (p: unknown) => {
      const path = String(p);
      if (path.endsWith("schema.json")) {
        return JSON.stringify({
          databases: [{
            database: { $id: "test123", name: "MyDatabase" },
            collections: [],
          }],
        });
      }
      return "{}";
    });

    await importDatabases(services, "/tmp/backup", remapper);

    expect(services.databases.create).toHaveBeenCalledWith({ databaseId: "test123", name: "MyDatabase" });
  });

  it("should use DB ID as name fallback when no schema", async () => {
    readdirMock.mockImplementation(async (p: unknown) => {
      const path = String(p);
      if (path.endsWith("databases")) return ["db_test123"];
      return [];
    });

    statMock.mockImplementation(async () => { throw new Error("not found"); });

    readFileMock.mockImplementation(async (p: unknown) => {
      const path = String(p);
      if (path.endsWith("schema.json")) throw new Error("no schema");
      return "{}";
    });

    await importDatabases(services, "/tmp/backup", remapper);

    expect(services.databases.create).toHaveBeenCalledWith({ databaseId: "test123", name: "test123" });
  });
});
