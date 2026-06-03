import pino from "pino";
import { RelationshipType, RelationMutate, OrderBy, IndexType } from "node-appwrite";
import type { AppwriteServices } from "../../appwrite/client";
import type { IdRemapper } from "../id-remapper";
import type { ImportModuleResult } from "./auth-importer";

type ExportedAttribute = {
  $id: string;
  key: string;
  type: string;
  required?: boolean;
  default?: unknown;
  array?: boolean;
  size?: number;
  elements?: string[];
  min?: number;
  max?: number;
  encrypt?: boolean;
  relatedCollectionId?: string;
  twoWay?: boolean;
  twoWayKey?: string;
  onDelete?: string;
  side?: string;
};

type ExportedIndex = {
  $id: string;
  key: string;
  type: string;
  attributes: string[];
  orders?: string[];
  lengths?: (number | null)[];
};

type ExportedCollectionSchema = {
  collection: { $id: string; name: string; permissions?: string[]; [key: string]: unknown };
  attributes: ExportedAttribute[];
  indexes: ExportedIndex[];
};

type SchemaData = {
  exportedAt: string;
  databases: Array<{
    database: { $id: string; name: string; [key: string]: unknown };
    collections: ExportedCollectionSchema[];
  }>;
};

const RELATIONSHIP_TYPES = ["oneToOne", "oneToMany", "manyToOne", "manyToMany"];
const ATTRIBUTE_POLL_MAX_ATTEMPTS = 30;
const ATTRIBUTE_POLL_INTERVAL_MS = 2000;

export async function restoreSchema(
  services: AppwriteServices,
  backupRoot: string,
  remapper: IdRemapper,
  log?: pino.Logger,
): Promise<ImportModuleResult> {
  const logger = log ?? pino({ level: "silent" });
  const result: ImportModuleResult = { module: "databases", status: "complete", created: 0, skipped: 0, errors: [] };

  try {
    const { readFile } = await import("node:fs/promises");
    const path = await import("node:path");

    const schemaPath = path.join(backupRoot, "databases", "schema.json");
    let schemaData: SchemaData;
    try {
      schemaData = JSON.parse(await readFile(schemaPath, "utf8")) as SchemaData;
    } catch {
      logger.warn("No schema.json found, skipping schema restore");
      return result;
    }

    logger.info({ dbCount: schemaData.databases.length }, "Starting schema restore");

    for (const db of schemaData.databases) {
      const dbId = String(db.database.$id);
      const destDbId = remapper.getDestination("database", dbId) ?? dbId;
      logger.info({ dbId, destDbId, collCount: db.collections.length }, "Restoring schema for database");

      for (const coll of db.collections) {
        const collId = String(coll.collection.$id);
        const destCollId = remapper.getDestination("collection", collId) ?? collId;

        const nonRelationshipAttrs = coll.attributes.filter((a) => !RELATIONSHIP_TYPES.includes(a.type));
        const relationshipAttrs = coll.attributes.filter((a) => RELATIONSHIP_TYPES.includes(a.type));

        logger.info({ collId, destCollId, attrs: nonRelationshipAttrs.length, rels: relationshipAttrs.length, indexes: coll.indexes.length }, "Restoring collection schema");

        for (const attr of nonRelationshipAttrs) {
          try {
            await createAttributeFromExport(services, destDbId, destCollId, attr);
            result.created += 1;
          } catch (error) {
            const msg = error instanceof Error ? error.message : "Unknown error";
            if (msg.includes("already exists") || msg.includes("already set")) {
              result.skipped += 1;
            } else {
              result.errors.push(`Attribute ${collId}/${attr.key}: ${msg}`);
              result.status = "partial";
              logger.error({ collId, key: attr.key, error: msg }, "Failed to create attribute");
            }
          }
        }

        for (const attr of relationshipAttrs) {
          try {
            await createAttributeFromExport(services, destDbId, destCollId, attr, remapper);
            result.created += 1;
          } catch (error) {
            const msg = error instanceof Error ? error.message : "Unknown error";
            if (msg.includes("already exists") || msg.includes("already set")) {
              result.skipped += 1;
            } else {
              result.errors.push(`Relationship ${collId}/${attr.key}: ${msg}`);
              result.status = "partial";
              logger.error({ collId, key: attr.key, error: msg }, "Failed to create relationship");
            }
          }
        }

        if (nonRelationshipAttrs.length > 0) {
          await waitForAttributesAvailable(services, destDbId, destCollId, nonRelationshipAttrs.map((a) => a.key), logger);
        }

        for (const idx of coll.indexes) {
          if (idx.key === "$id" || idx.key === "$sequence") continue;

          try {
            await createIndexFromExport(services, destDbId, destCollId, idx);
            result.created += 1;
          } catch (error) {
            const msg = error instanceof Error ? error.message : "Unknown error";
            if (msg.includes("already exists") || msg.includes("already set")) {
              result.skipped += 1;
            } else {
              result.errors.push(`Index ${collId}/${idx.key}: ${msg}`);
              result.status = "partial";
            }
          }
        }
      }
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Unknown error";
    result.errors.push(`Schema restore failed: ${msg}`);
    result.status = "failed";
    logger.error({ error: msg }, "Schema restore failed");
  }

  logger.info({ created: result.created, skipped: result.skipped, errorCount: result.errors.length, status: result.status }, "Schema restore complete");
  return result;
}

async function createAttributeFromExport(
  services: AppwriteServices,
  databaseId: string,
  collectionId: string,
  attr: ExportedAttribute,
  remapper?: IdRemapper,
): Promise<void> {
  const key = attr.key;
  const required = attr.required ?? false;
  const array = attr.array ?? false;
  const hasDefault = attr.default !== undefined && attr.default !== null;
  const canSetDefault = !required && hasDefault;

  switch (attr.type) {
    case "boolean":
      await services.databases.createBooleanAttribute({
        databaseId,
        collectionId,
        key,
        required,
        ...(canSetDefault ? { xdefault: Boolean(attr.default) } : {}),
        array,
      });
      break;

    case "datetime":
      await services.databases.createDatetimeAttribute({
        databaseId,
        collectionId,
        key,
        required,
        ...(canSetDefault ? { xdefault: String(attr.default) } : {}),
        array,
      });
      break;

    case "email":
      await services.databases.createEmailAttribute({
        databaseId,
        collectionId,
        key,
        required,
        ...(canSetDefault ? { xdefault: String(attr.default) } : {}),
        array,
      });
      break;

    case "enum":
      await services.databases.createEnumAttribute({
        databaseId,
        collectionId,
        key,
        elements: attr.elements ?? [],
        required,
        ...(canSetDefault ? { xdefault: String(attr.default) } : {}),
        array,
      });
      break;

    case "float":
    case "double": {
      const minVal = attr.min !== undefined ? Number(attr.min) : undefined;
      const maxVal = attr.max !== undefined ? Number(attr.max) : undefined;
      await services.databases.createFloatAttribute({
        databaseId,
        collectionId,
        key,
        required,
        ...(minVal !== undefined && Number.isFinite(minVal) ? { min: minVal } : {}),
        ...(maxVal !== undefined && Number.isFinite(maxVal) ? { max: maxVal } : {}),
        ...(canSetDefault ? { xdefault: Number(attr.default) } : {}),
        array,
      });
      break;
    }

    case "integer": {
      const minVal = attr.min !== undefined ? Number(attr.min) : undefined;
      const maxVal = attr.max !== undefined ? Number(attr.max) : undefined;
      await services.databases.createIntegerAttribute({
        databaseId,
        collectionId,
        key,
        required,
        ...(minVal !== undefined && Number.isSafeInteger(minVal) ? { min: minVal } : {}),
        ...(maxVal !== undefined && Number.isSafeInteger(maxVal) ? { max: maxVal } : {}),
        ...(canSetDefault ? { xdefault: Number(attr.default) } : {}),
        array,
      });
      break;
    }

    case "string":
      await services.databases.createStringAttribute({
        databaseId,
        collectionId,
        key,
        size: attr.size ?? 256,
        required,
        ...(canSetDefault ? { xdefault: String(attr.default) } : {}),
        array,
        encrypt: attr.encrypt ?? false,
      });
      break;

    case "url":
      await services.databases.createUrlAttribute({
        databaseId,
        collectionId,
        key,
        required,
        ...(attr.default !== undefined ? { xdefault: String(attr.default) } : {}),
        array,
      });
      break;

    case "oneToOne":
    case "oneToMany":
    case "manyToOne":
    case "manyToMany": {
      if (!attr.relatedCollectionId) {
        throw new Error(`Relationship ${key} missing relatedCollectionId`);
      }

      const destRelatedId = remapper?.getDestination("collection", attr.relatedCollectionId) ?? attr.relatedCollectionId;

      const relType = attr.type === "oneToOne" ? RelationshipType.OneToOne
        : attr.type === "manyToOne" ? RelationshipType.ManyToOne
        : attr.type === "manyToMany" ? RelationshipType.ManyToMany
          : RelationshipType.OneToMany;

      const deleteAction = attr.onDelete === "restrict" ? RelationMutate.Restrict
        : attr.onDelete === "cascade" ? RelationMutate.Cascade
          : RelationMutate.SetNull;

      await services.databases.createRelationshipAttribute({
        databaseId,
        collectionId,
        relatedCollectionId: destRelatedId,
        type: relType,
        twoWay: attr.twoWay ?? false,
        key,
        ...(attr.twoWayKey !== undefined ? { twoWayKey: attr.twoWayKey } : {}),
        onDelete: deleteAction,
      });
      break;
    }

    default:
      throw new Error(`Unknown attribute type: ${attr.type}`);
  }
}

async function waitForAttributesAvailable(
  services: AppwriteServices,
  databaseId: string,
  collectionId: string,
  attributeKeys: string[],
  log?: pino.Logger,
): Promise<void> {
  for (const key of attributeKeys) {
    let found = false;
    for (let attempt = 0; attempt < ATTRIBUTE_POLL_MAX_ATTEMPTS; attempt++) {
      try {
        const attr = await services.databases.getAttribute({ databaseId, collectionId, key });
        if ((attr as unknown as Record<string, unknown>).status === "available") {
          found = true;
          break;
        }
      } catch {
        // Attribute not found yet, keep polling
      }
      await new Promise((resolve) => setTimeout(resolve, ATTRIBUTE_POLL_INTERVAL_MS));
    }
    if (!found) {
      log?.warn({ databaseId, collectionId, key }, "Attribute not available after polling");
    }
  }
}

async function createIndexFromExport(
  services: AppwriteServices,
  databaseId: string,
  collectionId: string,
  idx: ExportedIndex,
): Promise<void> {
  const orders = idx.orders?.map((o) => (o === "desc" ? OrderBy.Desc : OrderBy.Asc));

  const idxType = idx.type === "unique" ? IndexType.Unique
    : idx.type === "fulltext" ? IndexType.Fulltext
      : IndexType.Key;

  await services.databases.createIndex({
    databaseId,
    collectionId,
    key: idx.key,
    type: idxType,
    attributes: idx.attributes,
    ...(orders !== undefined ? { orders } : {}),
    ...(idx.lengths !== undefined ? { lengths: idx.lengths as number[] } : {}),
  });
}
