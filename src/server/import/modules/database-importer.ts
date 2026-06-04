import pino from "pino";
import type { AppwriteServices } from "../../appwrite/client";
import type { IdRemapper } from "../id-remapper";
import type { ImportModuleResult } from "./auth-importer";
import { restoreSchema } from "./schema-restorer";

interface SchemaCollection {
  collection: { $id: string; name: string; $permissions?: string[] };
  attributes: Record<string, unknown>[];
  indexes: Record<string, unknown>[];
}

interface SchemaDatabase {
  database: { $id: string; name: string };
  collections: SchemaCollection[];
}

interface SchemaFile {
  databases: SchemaDatabase[];
}

function buildSchemaIndex(schemaPath: string, readFile: (p: string, enc: BufferEncoding) => Promise<string>): Promise<Map<string, SchemaDatabase>> {
  return readFile(schemaPath, "utf8")
    .then((raw) => {
      const schema = JSON.parse(raw) as SchemaFile;
      const map = new Map<string, SchemaDatabase>();
      for (const db of schema.databases) {
        map.set(String(db.database.$id), db);
      }
      return map;
    })
    .catch(() => new Map<string, SchemaDatabase>());
}

function buildCollectionIndex(schemaDb: SchemaDatabase | undefined): Map<string, SchemaCollection> {
  const map = new Map<string, SchemaCollection>();
  if (!schemaDb) return map;
  for (const coll of schemaDb.collections) {
    map.set(String(coll.collection.$id), coll);
  }
  return map;
}

/**
 * Importa todas las bases de datos, colecciones y documentos desde un backup.
 *
 * Recorre el directorio `databases/` del backup, crea las bases de datos y
 * colecciones que no existan, restaura esquemas (atributos e índices) y
 * finalmente importa los documentos archivo por archivo.
 *
 * @param services - Cliente de Appwrite con los servicios disponibles (databases, etc.).
 * @param backupRoot - Ruta raíz del directorio de backup.
 * @param remapper - Instancia de IdRemapper para traducir IDs originales a IDs destino.
 * @param log - Logger opcional de pino. Si no se provee se usa un logger silencioso.
 * @returns Un {@link ImportModuleResult} con el resumen de la importación (creados, omitidos, errores).
 */
export async function importDatabases(
  services: AppwriteServices,
  backupRoot: string,
  remapper: IdRemapper,
  log?: pino.Logger,
): Promise<ImportModuleResult> {
  const logger = log ?? pino({ level: "silent" });
  const result: ImportModuleResult = { module: "databases", status: "complete", created: 0, skipped: 0, errors: [] };

  try {
    const { readFile, readdir, stat } = await import("node:fs/promises");
    const path = await import("node:path");

    const databasesDir = path.join(backupRoot, "databases");
    let entries: string[];
    try {
      entries = await readdir(databasesDir);
    } catch {
      logger.warn("No databases/ directory found, skipping databases import");
      return result;
    }

    const dbDirs = entries.filter((e) => e.startsWith("db_"));
    logger.info({ dbCount: dbDirs.length, dbDirs }, "Found database directories");

    const schemaIndex = await buildSchemaIndex(path.join(databasesDir, "schema.json"), readFile);

    for (const dbDir of dbDirs) {
      const dbId = dbDir.replace("db_", "");
      const destDbId = remapper.getDestination("database", dbId) ?? dbId;
      logger.info({ dbId, destDbId }, "Processing database");

      const schemaDb = schemaIndex.get(dbId);

      try {
        const existing = await services.databases.get({ databaseId: destDbId });
        remapper.addMapping("database", dbId, String(existing.$id));
        logger.info({ dbId, existingDbId: existing.$id }, "Database already exists, mapped");
      } catch {
        const dbName = schemaDb?.database?.name ?? dbId;
        try {
          const created = await services.databases.create({
            databaseId: destDbId,
            name: dbName,
          });
          remapper.addMapping("database", dbId, String(created.$id));
          result.created += 1;
          logger.info({ dbId, createdDbId: created.$id }, "Created database");
        } catch (error) {
          const msg = error instanceof Error ? error.message : "Unknown error";
          result.errors.push(`Database ${dbId}: ${msg}`);
          result.status = "partial";
          logger.error({ dbId, error: msg }, "Failed to create database");
          continue;
        }
      }

      const dbDirPath = path.join(databasesDir, dbDir);
      let dirEntries: string[];
      try {
        dirEntries = await readdir(dbDirPath);
      } catch {
        continue;
      }

      const collSchemaIndex = buildCollectionIndex(schemaDb);

      const collFiles = dirEntries.filter((e) => e.startsWith("collection_") && e.endsWith(".ndjson"));
      const collDirsOld = dirEntries.filter((e) => e.startsWith("coll_"));

      const allCollIds = new Set<string>();

      for (const f of collFiles) {
        allCollIds.add(f.replace("collection_", "").replace(".ndjson", ""));
      }
      for (const d of collDirsOld) {
        allCollIds.add(d.replace("coll_", ""));
      }

      logger.info({ dbId, collCount: allCollIds.size, collIds: [...allCollIds] }, "Found collections");

      for (const collId of allCollIds) {
        const destCollId = remapper.getDestination("collection", collId) ?? collId;
        const collSchema = collSchemaIndex.get(collId);

        try {
          const existing = await services.databases.getCollection({ databaseId: destDbId, collectionId: destCollId });
          remapper.addMapping("collection", collId, String(existing.$id));
          logger.info({ dbId, collId, existingCollId: existing.$id }, "Collection already exists, mapped");
        } catch {
          const collName = collSchema?.collection?.name ?? collId;
          const collPerms = (collSchema?.collection?.$permissions as string[]) ?? [];
          try {
            const created = await services.databases.createCollection({
              databaseId: destDbId,
              collectionId: destCollId,
              name: collName,
              permissions: collPerms,
            });
            remapper.addMapping("collection", collId, String(created.$id));
            result.created += 1;
            logger.info({ dbId, collId, createdCollId: created.$id }, "Created collection");
          } catch (error) {
            const msg = error instanceof Error ? error.message : "Unknown error";
            result.errors.push(`Collection ${dbId}/${collId}: ${msg}`);
            result.status = "partial";
            logger.error({ dbId, collId, error: msg }, "Failed to create collection");
            continue;
          }
        }
      }

      logger.info({ dbId }, "Restoring schema (attributes/indexes) before documents");
      const schemaResult = await restoreSchema(services, backupRoot, remapper, log);
      result.created += schemaResult.created;
      result.skipped += schemaResult.skipped;
      result.errors.push(...schemaResult.errors);
      if (schemaResult.status === "partial" && result.status !== "failed") {
        result.status = "partial";
      } else if (schemaResult.status === "failed") {
        result.status = "failed";
      }

      for (const collId of allCollIds) {
        const destCollId = remapper.getDestination("collection", collId) ?? collId;

        let docsPath = path.join(dbDirPath, `collection_${collId}.ndjson`);
        let isOldFormat = false;
        try {
          await stat(docsPath);
        } catch {
          docsPath = path.join(dbDirPath, `coll_${collId}`, "documents.ndjson");
          isOldFormat = true;
        }

        try {
          const docsContent = await readFile(docsPath, "utf8");
          const docLines = docsContent.split("\n").filter((l) => l.trim().length > 0);
          logger.info({ dbId, collId, docCount: docLines.length, format: isOldFormat ? "old" : "new" }, "Importing documents");

          let importedCount = 0;
          let failedCount = 0;

          for (const line of docLines) {
            try {
              const doc = JSON.parse(line) as Record<string, unknown>;
              const sourceDocId = String(doc.$id ?? "");

              try {
                await services.databases.getDocument({
                  databaseId: destDbId,
                  collectionId: destCollId,
                  documentId: sourceDocId,
                });
                result.skipped += 1;
              } catch {
                try {
                  // eslint-disable-next-line @typescript-eslint/no-unused-vars
                  const { $id: _id, $collectionId: _cid, $databaseId: _did, $createdAt: _ca, $updatedAt: _ua, $permissions: _p, ...rawData } = doc as Record<string, unknown>;

                  const cleanData: Record<string, unknown> = {};
                  for (const [k, v] of Object.entries(rawData)) {
                    if (v !== null && v !== undefined) {
                      cleanData[k] = v;
                    }
                  }

                  await services.databases.createDocument({
                    databaseId: destDbId,
                    collectionId: destCollId,
                    documentId: sourceDocId,
                    data: cleanData,
                  });
                  remapper.addMapping("document", sourceDocId, sourceDocId);
                  result.created += 1;
                  importedCount++;
                } catch (error) {
                  const msg = error instanceof Error ? error.message : "Unknown error";
                  result.errors.push(`Document ${collId}/${sourceDocId}: ${msg}`);
                  result.status = "partial";
                  failedCount++;
                  logger.error({ docId: sourceDocId, collId, error: msg, keys: Object.keys(doc).filter((k) => !k.startsWith("$")) }, "Failed to create document");
                }
              }
            } catch {
              // Skip invalid lines
            }
          }

          logger.info({ collId, imported: importedCount, skipped: result.skipped, failedCount, total: docLines.length }, "Collection import summary");
        } catch {
          logger.warn({ dbId, collId, docsPath }, "No documents file found");
        }
      }
    }

    logger.info({ created: result.created, skipped: result.skipped, errorCount: result.errors.length, status: result.status }, "Database import complete");
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Unknown error";
    result.errors.push(`Database import failed: ${msg}`);
    result.status = "failed";
  }

  return result;
}
