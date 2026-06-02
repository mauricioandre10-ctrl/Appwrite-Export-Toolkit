import { readFile } from "node:fs/promises";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

import { IdRemapper } from "../id-remapper";
import { restoreSchema } from "./schema-restorer";

vi.mock("node:fs/promises", () => ({
  readFile: vi.fn(),
}));

const mockedReadFile = vi.mocked(readFile);

function createMockServices() {
  return {
    databases: {
      createBooleanAttribute: vi.fn().mockResolvedValue({ $id: "attr_bool" }),
      createDatetimeAttribute: vi.fn().mockResolvedValue({ $id: "attr_dt" }),
      createEmailAttribute: vi.fn().mockResolvedValue({ $id: "attr_email" }),
      createEnumAttribute: vi.fn().mockResolvedValue({ $id: "attr_enum" }),
      createFloatAttribute: vi.fn().mockResolvedValue({ $id: "attr_float" }),
      createIntegerAttribute: vi.fn().mockResolvedValue({ $id: "attr_int" }),
      createStringAttribute: vi.fn().mockResolvedValue({ $id: "attr_str" }),
      createUrlAttribute: vi.fn().mockResolvedValue({ $id: "attr_url" }),
      createRelationshipAttribute: vi.fn().mockResolvedValue({ $id: "attr_rel" }),
      createIndex: vi.fn().mockResolvedValue({ $id: "idx_1" }),
      getAttribute: vi.fn().mockResolvedValue({ key: "name", status: "available" }),
    },
  } as unknown as Parameters<typeof restoreSchema>[0];
}

describe("restoreSchema", () => {
  const mockBackupRoot = "/tmp/test-backup";
  let remapper: IdRemapper;

  beforeEach(() => {
    remapper = new IdRemapper();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns complete with 0 created when no schema.json exists", async () => {
    const services = createMockServices();
    mockedReadFile.mockRejectedValue(new Error("ENOENT"));

    const result = await restoreSchema(services, mockBackupRoot, remapper);
    expect(result.status).toBe("complete");
    expect(result.created).toBe(0);
  });

  it("creates boolean attributes", async () => {
    const services = createMockServices();
    const schemaData = {
      exportedAt: "2026-06-01T00:00:00Z",
      databases: [
        {
          database: { $id: "db1", name: "Test DB" },
          collections: [
            {
              collection: { $id: "coll1", name: "Test Collection" },
              attributes: [{ $id: "attr1", key: "active", type: "boolean", required: true, default: false }],
              indexes: [],
            },
          ],
        },
      ],
    };

    mockedReadFile.mockResolvedValue(JSON.stringify(schemaData));

    const result = await restoreSchema(services, mockBackupRoot, remapper);
    expect(result.status).toBe("complete");
    expect(result.created).toBe(1);
    expect(services.databases.createBooleanAttribute).toHaveBeenCalledWith({
      databaseId: "db1",
      collectionId: "coll1",
      key: "active",
      required: true,
      array: false,
    });
  });

  it("creates string attributes with encrypt", async () => {
    const services = createMockServices();
    const schemaData = {
      exportedAt: "2026-06-01T00:00:00Z",
      databases: [
        {
          database: { $id: "db1", name: "Test DB" },
          collections: [
            {
              collection: { $id: "coll1", name: "Test Collection" },
              attributes: [{ $id: "attr1", key: "secret", type: "string", size: 512, encrypt: true }],
              indexes: [],
            },
          ],
        },
      ],
    };

    mockedReadFile.mockResolvedValue(JSON.stringify(schemaData));

    const result = await restoreSchema(services, mockBackupRoot, remapper);
    expect(result.status).toBe("complete");
    expect(services.databases.createStringAttribute).toHaveBeenCalledWith({
      databaseId: "db1",
      collectionId: "coll1",
      key: "secret",
      size: 512,
      required: false,
      array: false,
      encrypt: true,
    });
  });

  it("creates enum attributes with elements", async () => {
    const services = createMockServices();
    const schemaData = {
      exportedAt: "2026-06-01T00:00:00Z",
      databases: [
        {
          database: { $id: "db1", name: "Test DB" },
          collections: [
            {
              collection: { $id: "coll1", name: "Test Collection" },
              attributes: [{ $id: "attr1", key: "status", type: "enum", elements: ["active", "inactive"], required: true }],
              indexes: [],
            },
          ],
        },
      ],
    };

    mockedReadFile.mockResolvedValue(JSON.stringify(schemaData));

    const result = await restoreSchema(services, mockBackupRoot, remapper);
    expect(result.status).toBe("complete");
    expect(services.databases.createEnumAttribute).toHaveBeenCalledWith({
      databaseId: "db1",
      collectionId: "coll1",
      key: "status",
      elements: ["active", "inactive"],
      required: true,
      array: false,
    });
  });

  it("creates relationship attributes using remapped collection IDs", async () => {
    const services = createMockServices();
    remapper.addMapping("collection", "coll2", "coll2_dest");
    const schemaData = {
      exportedAt: "2026-06-01T00:00:00Z",
      databases: [
        {
          database: { $id: "db1", name: "Test DB" },
          collections: [
            {
              collection: { $id: "coll1", name: "Test Collection" },
              attributes: [
                { $id: "attr1", key: "name", type: "string", size: 256 },
                { $id: "attr2", key: "userId", type: "oneToOne", relatedCollectionId: "coll2", twoWay: false, onDelete: "cascade" },
              ],
              indexes: [],
            },
          ],
        },
      ],
    };

    mockedReadFile.mockResolvedValue(JSON.stringify(schemaData));

    const result = await restoreSchema(services, mockBackupRoot, remapper);
    expect(result.status).toBe("complete");
    expect(result.created).toBe(2);
    expect(services.databases.createStringAttribute).toHaveBeenCalled();
    expect(services.databases.createRelationshipAttribute).toHaveBeenCalledWith({
      databaseId: "db1",
      collectionId: "coll1",
      relatedCollectionId: "coll2_dest",
      type: "oneToOne",
      twoWay: false,
      key: "userId",
      onDelete: "cascade",
    });
  });

  it("creates indexes after attributes", async () => {
    const services = createMockServices();
    const schemaData = {
      exportedAt: "2026-06-01T00:00:00Z",
      databases: [
        {
          database: { $id: "db1", name: "Test DB" },
          collections: [
            {
              collection: { $id: "coll1", name: "Test Collection" },
              attributes: [{ $id: "attr1", key: "email", type: "email" }],
              indexes: [{ $id: "idx1", key: "email_idx", type: "unique", attributes: ["email"], orders: ["asc"] }],
            },
          ],
        },
      ],
    };

    mockedReadFile.mockResolvedValue(JSON.stringify(schemaData));

    const result = await restoreSchema(services, mockBackupRoot, remapper);
    expect(result.status).toBe("complete");
    expect(services.databases.createIndex).toHaveBeenCalledWith({
      databaseId: "db1",
      collectionId: "coll1",
      key: "email_idx",
      type: "unique",
      attributes: ["email"],
      orders: ["asc"],
      lengths: undefined,
    });
  });

  it("skips $id and $sequence indexes", async () => {
    const services = createMockServices();
    const schemaData = {
      exportedAt: "2026-06-01T00:00:00Z",
      databases: [
        {
          database: { $id: "db1", name: "Test DB" },
          collections: [
            {
              collection: { $id: "coll1", name: "Test Collection" },
              attributes: [],
              indexes: [
                { $id: "idx1", key: "$id", type: "key", attributes: ["$id"] },
                { $id: "idx2", key: "$sequence", type: "key", attributes: ["$sequence"] },
                { $id: "idx3", key: "email_idx", type: "unique", attributes: ["email"] },
              ],
            },
          ],
        },
      ],
    };

    mockedReadFile.mockResolvedValue(JSON.stringify(schemaData));

    const result = await restoreSchema(services, mockBackupRoot, remapper);
    expect(result.status).toBe("complete");
    expect(services.databases.createIndex).toHaveBeenCalledTimes(1);
    expect(services.databases.createIndex).toHaveBeenCalledWith({
      databaseId: "db1",
      collectionId: "coll1",
      key: "email_idx",
      type: "unique",
      attributes: ["email"],
      orders: undefined,
      lengths: undefined,
    });
  });

  it("reports partial status when attribute creation fails with non-duplicate error", async () => {
    const services = createMockServices();
    (services.databases.createBooleanAttribute as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("Permission denied"));
    const schemaData = {
      exportedAt: "2026-06-01T00:00:00Z",
      databases: [
        {
          database: { $id: "db1", name: "Test DB" },
          collections: [
            {
              collection: { $id: "coll1", name: "Test Collection" },
              attributes: [{ $id: "attr1", key: "active", type: "boolean" }],
              indexes: [],
            },
          ],
        },
      ],
    };

    mockedReadFile.mockResolvedValue(JSON.stringify(schemaData));

    const result = await restoreSchema(services, mockBackupRoot, remapper);
    expect(result.status).toBe("partial");
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain("Permission denied");
  });

  it("skips duplicate attribute errors", async () => {
    const services = createMockServices();
    (services.databases.createBooleanAttribute as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("already exists"));
    const schemaData = {
      exportedAt: "2026-06-01T00:00:00Z",
      databases: [
        {
          database: { $id: "db1", name: "Test DB" },
          collections: [
            {
              collection: { $id: "coll1", name: "Test Collection" },
              attributes: [{ $id: "attr1", key: "active", type: "boolean" }],
              indexes: [],
            },
          ],
        },
      ],
    };

    mockedReadFile.mockResolvedValue(JSON.stringify(schemaData));

    const result = await restoreSchema(services, mockBackupRoot, remapper);
    expect(result.status).toBe("complete");
    expect(result.skipped).toBe(1);
  });
});
