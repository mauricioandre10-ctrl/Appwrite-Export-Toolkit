import type { AppwriteServices } from "../appwrite/client";
import type { BackupWriter } from "../backup/backup-writer";
import { listAll, paginateRows } from "../utils/pagination";
import type { ModuleExportResult } from "./types";

/**
 * Exporta bases de datos, colecciones, atributos, índices y documentos de Appwrite.
 * Genera un schema JSON con la estructura completa y archivos NDJSON por colección.
 *
 * @param services - Cliente Appwrite con el SDK de bases de datos.
 * @param writer - BackupWriter encargado de crear directorios y escribir los archivos de backup.
 * @returns Resultado del export con contadores de DBs, colecciones y documentos, más warnings.
 * @throws Si falla la escritura de archivos o la conexión con Appwrite.
 *
 * @remarks
 * - La API de Databases está deprecated en Appwrite 1.8.x (reemplazada por TablesDB), pero sigue funcionando.
 * - Los campos de sistema como `$createdAt`, `$updatedAt` y `$sequence` pueden no ser restaurables.
 * - Los documentos se exportan en streaming por colección para manejar colecciones grandes.
 * - Cada colección genera un archivo NDJSON independiente bajo `databases/db_{id}/collection_{id}.ndjson`.
 * - El schema completo (DBs, colecciones, atributos, índices) se guarda en `databases/schema.json`.
 */
export async function exportDatabases(services: AppwriteServices, writer: BackupWriter): Promise<ModuleExportResult> {
  await writer.ensureDir("databases");

  const databases = await listAll("databases", (queries) => services.databases.list(queries));
  const schemaDatabases = [];
  const files: string[] = [];
  const warnings = [
    "Databases API is deprecated in Appwrite 1.8.x in favor of TablesDB, but remains usable for current project export.",
    "Document system fields like $createdAt, $updatedAt and $sequence may not be restorable.",
  ];
  let collectionCount = 0;
  let attributeCount = 0;
  let indexCount = 0;
  let documentCount = 0;

  for (const database of databases.rows) {
    const databaseId = String(database.$id);
    const collections = await listAll("collections", (queries) => services.databases.listCollections(databaseId, queries));
    const schemaCollections = [];
    collectionCount += collections.total;

    for (const collection of collections.rows) {
      const collectionId = String(collection.$id);
      const [attributes, indexes] = await Promise.all([
        listAll("attributes", (queries) => services.databases.listAttributes(databaseId, collectionId, queries)),
        listAll("indexes", (queries) => services.databases.listIndexes(databaseId, collectionId, queries)),
      ]);

      attributeCount += attributes.total;
      indexCount += indexes.total;

      schemaCollections.push({
        collection,
        attributes: attributes.rows,
        indexes: indexes.rows,
      });

      let collectionDocumentCount = 0;
      files.push(
        await writer.writeNdjsonStream(`databases/db_${databaseId}/collection_${collectionId}.ndjson`, async (append) => {
          for await (const page of paginateRows("documents", (queries) => services.databases.listDocuments(databaseId, collectionId, queries))) {
            collectionDocumentCount += page.rows.length;
            for (const document of page.rows) {
              await append(document);
            }
          }
        }),
      );
      documentCount += collectionDocumentCount;
    }

    schemaDatabases.push({
      database,
      collections: schemaCollections,
    });
  }

  files.push(
    await writer.writeJson("databases/schema.json", {
      exportedAt: new Date().toISOString(),
      databases: schemaDatabases,
    }),
  );

  files.push(
    await writer.writeJson("databases/meta.json", {
      exportedAt: new Date().toISOString(),
      counts: {
        databases: databases.total,
        collections: collectionCount,
        attributes: attributeCount,
        indexes: indexCount,
        documents: documentCount,
      },
      warnings,
    }),
  );

  return {
    module: "databases",
    status: "complete",
    counts: {
      databases: databases.total,
      collections: collectionCount,
      documents: documentCount,
    },
    warnings,
    files,
  };
}
