import { access, readFile } from "node:fs/promises";
import path from "node:path";

import { sha256File } from "../backup/checksum-service";
import type { BackupManifest } from "../types/backup";

export type ValidationSeverity = "error" | "warning";

export type ValidationIssue = {
  severity: ValidationSeverity;
  code: string;
  message: string;
  path?: string;
};

export type BackupValidationResult = {
  ok: boolean;
  backupRoot: string;
  checkedAt: string;
  counts: {
    errors: number;
    warnings: number;
    checksums: number;
    users: number;
    storageFiles: number;
    databaseDocuments: number;
  };
  issues: ValidationIssue[];
};

type JsonObject = Record<string, unknown>;

type BackupContext = {
  root: string;
  issues: ValidationIssue[];
  userIds: Set<string>;
  storageFileIds: Set<string>;
  databaseIds: Set<string>;
  collectionIdsByDatabase: Map<string, Set<string>>;
  databaseDocumentCount: number;
};

export async function validateBackup(backupRootInput: string): Promise<BackupValidationResult> {
  const root = path.resolve(/* turbopackIgnore: true */ backupRootInput);
  const issues: ValidationIssue[] = [];
  const context: BackupContext = {
    root,
    issues,
    userIds: new Set<string>(),
    storageFileIds: new Set<string>(),
    databaseIds: new Set<string>(),
    collectionIdsByDatabase: new Map<string, Set<string>>(),
    databaseDocumentCount: 0,
  };

  const manifest = await readManifest(root, issues);

  if (manifest !== null) {
    await validateManifestFiles(context, manifest);
    await validateChecksums(context, manifest);
    await validateAuth(context, manifest);
    await validateStorage(context, manifest);
    await validateDatabases(context, manifest);
    await validateFunctions(context, manifest);
    validateModuleStatus(context, manifest);
    validateRestoreOrder(context, manifest);
  }

  const errors = issues.filter((issue) => issue.severity === "error").length;
  const warnings = issues.filter((issue) => issue.severity === "warning").length;

  return {
    ok: errors === 0,
    backupRoot: root,
    checkedAt: new Date().toISOString(),
    counts: {
      errors,
      warnings,
      checksums: manifest === null ? 0 : Object.keys(manifest.checksums).length,
      users: context.userIds.size,
      storageFiles: context.storageFileIds.size,
      databaseDocuments: context.databaseDocumentCount,
    },
    issues,
  };
}

export function extractUserIdsFromPermissions(permissions: readonly unknown[]): string[] {
  const userIds = new Set<string>();
  const userPermissionPattern = /user:([^"\)]+)/g;

  for (const permission of permissions) {
    if (typeof permission !== "string") {
      continue;
    }

    for (const match of permission.matchAll(userPermissionPattern)) {
      const userId = match[1];
      if (userId !== undefined && userId.length > 0) {
        userIds.add(userId);
      }
    }
  }

  return [...userIds];
}

export function findLikelyFileReferences(value: unknown, sourcePath: string): Array<{ path: string; fileId: string }> {
  const refs: Array<{ path: string; fileId: string }> = [];
  visitLikelyFileReferences(value, sourcePath, refs);
  return refs;
}

async function readManifest(root: string, issues: ValidationIssue[]): Promise<BackupManifest | null> {
  const manifestPath = path.join(/* turbopackIgnore: true */ root, "manifest.json");

  try {
    const manifest = await readJson(manifestPath);
    if (!isManifest(manifest)) {
      issues.push({
        severity: "error",
        code: "manifest.invalid",
        message: "manifest.json does not match the expected backup manifest shape.",
        path: "manifest.json",
      });
      return null;
    }

    return manifest;
  } catch (error) {
    issues.push({
      severity: "error",
      code: "manifest.missing",
      message: error instanceof Error ? error.message : "Unable to read manifest.json.",
      path: "manifest.json",
    });
    return null;
  }
}

async function validateManifestFiles(context: BackupContext, manifest: BackupManifest): Promise<void> {
  const expectedPaths = ["project.json"];

  for (const moduleName of manifest.modules) {
    if (moduleName === "project") {
      continue;
    }

    expectedPaths.push(moduleName);
  }

  await Promise.all(
    expectedPaths.map(async (relativePath) => {
      try {
        await access(path.join(/* turbopackIgnore: true */ context.root, relativePath));
      } catch {
        addIssue(context, "error", "backup.path_missing", `Expected backup path is missing: ${relativePath}`, relativePath);
      }
    }),
  );
}

async function validateChecksums(context: BackupContext, manifest: BackupManifest): Promise<void> {
  for (const [relativePath, expectedChecksum] of Object.entries(manifest.checksums)) {
    const absolutePath = path.join(/* turbopackIgnore: true */ context.root, relativePath);

    try {
      const actualChecksum = await sha256File(absolutePath);
      if (actualChecksum !== expectedChecksum) {
        addIssue(
          context,
          "error",
          "checksum.mismatch",
          `Checksum mismatch for ${relativePath}.`,
          relativePath,
        );
      }
    } catch (error) {
      addIssue(
        context,
        "error",
        "checksum.file_missing",
        error instanceof Error ? error.message : `Unable to checksum ${relativePath}.`,
        relativePath,
      );
    }
  }
}

async function validateAuth(context: BackupContext, manifest: BackupManifest): Promise<void> {
  if (!manifest.modules.includes("auth")) {
    return;
  }

  const users = await readNdjsonSafe(context, "auth/users.ndjson");
  const teams = await readNdjsonSafe(context, "auth/teams.ndjson");
  const memberships = await readNdjsonSafe(context, "auth/memberships.ndjson");

  for (const user of users) {
    if (isObject(user) && typeof user.$id === "string") {
      context.userIds.add(user.$id);
    }
  }

  compareCount(context, "users", manifest.counts.users, users.length, "auth/users.ndjson");
  compareCount(context, "teams", manifest.counts.teams, teams.length, "auth/teams.ndjson");
  compareCount(context, "memberships", manifest.counts.memberships, memberships.length, "auth/memberships.ndjson");
}

async function validateStorage(context: BackupContext, manifest: BackupManifest): Promise<void> {
  if (!manifest.modules.includes("storage")) {
    return;
  }

  const buckets = await readJsonSafe(context, "storage/buckets.json");
  const bucketRows = Array.isArray(buckets) ? buckets : [];
  let fileCount = 0;

  for (const bucketRow of bucketRows) {
    if (!isObject(bucketRow) || !isObject(bucketRow.bucket) || typeof bucketRow.bucket.$id !== "string") {
      addIssue(context, "warning", "storage.bucket_shape", "Storage bucket entry has unexpected shape.", "storage/buckets.json");
      continue;
    }

    const bucketId = bucketRow.bucket.$id;
    const filesPath = `storage/bucket_${bucketId}/files.ndjson`;
    const files = await readNdjsonSafe(context, filesPath);
    fileCount += files.length;

    validatePermissions(context, bucketRow.bucket.$permissions, `storage bucket ${bucketId}`, "storage/buckets.json");

    for (const file of files) {
      if (!isObject(file) || typeof file.$id !== "string") {
        addIssue(context, "warning", "storage.file_shape", "Storage file entry has unexpected shape.", filesPath);
        continue;
      }

      context.storageFileIds.add(file.$id);
      validatePermissions(context, file.$permissions, `storage file ${bucketId}/${file.$id}`, filesPath);

      const blobPath = typeof file.blobPath === "string" ? file.blobPath : `storage/bucket_${bucketId}/blobs/${file.$id}`;
      try {
        await access(path.join(/* turbopackIgnore: true */ context.root, blobPath));
      } catch {
        addIssue(context, "error", "storage.blob_missing", `Missing storage blob ${bucketId}/${file.$id}.`, blobPath);
      }

      if (typeof file.blobSha256 === "string") {
        const actualSha256 = await sha256File(path.join(/* turbopackIgnore: true */ context.root, blobPath));
        if (actualSha256 !== file.blobSha256) {
          addIssue(context, "error", "storage.blob_checksum", `Blob checksum mismatch for ${bucketId}/${file.$id}.`, blobPath);
        }
      }
    }
  }

  compareCount(context, "buckets", manifest.counts.buckets, bucketRows.length, "storage/buckets.json");
  compareCount(context, "files", manifest.counts.files, fileCount, "storage/buckets.json");
}

async function validateDatabases(context: BackupContext, manifest: BackupManifest): Promise<void> {
  if (!manifest.modules.includes("databases")) {
    return;
  }

  const schema = await readJsonSafe(context, "databases/schema.json");
  const databases = isObject(schema) && Array.isArray(schema.databases) ? schema.databases : [];
  let collectionCount = 0;

  for (const databaseRow of databases) {
    if (!isObject(databaseRow) || !isObject(databaseRow.database) || typeof databaseRow.database.$id !== "string") {
      addIssue(context, "warning", "database.schema_shape", "Database schema entry has unexpected shape.", "databases/schema.json");
      continue;
    }

    const databaseId = databaseRow.database.$id;
    context.databaseIds.add(databaseId);
    const collectionIds = new Set<string>();
    context.collectionIdsByDatabase.set(databaseId, collectionIds);
    const collections = Array.isArray(databaseRow.collections) ? databaseRow.collections : [];
    collectionCount += collections.length;

    for (const collectionRow of collections) {
      if (!isObject(collectionRow) || !isObject(collectionRow.collection) || typeof collectionRow.collection.$id !== "string") {
        addIssue(context, "warning", "database.collection_shape", "Collection schema entry has unexpected shape.", "databases/schema.json");
        continue;
      }

      const collectionId = collectionRow.collection.$id;
      collectionIds.add(collectionId);
      validatePermissions(context, collectionRow.collection.$permissions, `collection ${databaseId}/${collectionId}`, "databases/schema.json");

      const documentsPath = `databases/db_${databaseId}/collection_${collectionId}.ndjson`;
      const documents = await readNdjsonSafe(context, documentsPath);
      context.databaseDocumentCount += documents.length;

      for (const document of documents) {
        validateDocument(context, document, documentsPath);
      }
    }
  }

  compareCount(context, "databases", manifest.counts.databases, databases.length, "databases/schema.json");
  compareCount(context, "collections", manifest.counts.collections, collectionCount, "databases/schema.json");
  compareCount(context, "documents", manifest.counts.documents, context.databaseDocumentCount, "databases/schema.json");
}

async function validateFunctions(context: BackupContext, manifest: BackupManifest): Promise<void> {
  if (!manifest.modules.includes("functions")) {
    return;
  }

  const functions = await readJsonSafe(context, "functions/functions.json");
  const functionRows = Array.isArray(functions) ? functions : [];

  for (const functionRow of functionRows) {
    if (!isObject(functionRow) || !isObject(functionRow.function)) {
      addIssue(context, "warning", "function.shape", "Function entry has unexpected shape.", "functions/functions.json");
      continue;
    }

    const functionId = typeof functionRow.function.$id === "string" ? functionRow.function.$id : "unknown";
    const events = Array.isArray(functionRow.function.events) ? functionRow.function.events : [];
    validateFunctionEvents(context, events, functionId);

    if (isObject(functionRow.exportStatus)) {
      const discovered = typeof functionRow.exportStatus.deploymentsDiscovered === "number" ? functionRow.exportStatus.deploymentsDiscovered : 0;
      const downloaded = typeof functionRow.exportStatus.deploymentsDownloaded === "number" ? functionRow.exportStatus.deploymentsDownloaded : 0;
      if (discovered > downloaded) {
        addIssue(
          context,
          "warning",
          "function.deployment_partial",
          `Function ${functionId} has ${discovered} discovered deployments but only ${downloaded} downloaded deployments.`,
          `functions/function_${functionId}/export-status.json`,
        );
      }
    }
  }

  compareCount(context, "functions", manifest.counts.functions, functionRows.length, "functions/functions.json");
}

function validateRestoreOrder(context: BackupContext, manifest: BackupManifest): void {
  const requiredOrder = ["auth", "messaging", "databases", "storage", "functions"];
  const actual = manifest.restoreOrder;

  for (const moduleName of requiredOrder) {
    if (!actual.includes(moduleName as never)) {
      addIssue(context, "warning", "restore_order.missing_module", `Restore order is missing ${moduleName}.`, "manifest.json");
    }
  }

  const authIndex = actual.indexOf("auth");
  const databaseIndex = actual.indexOf("databases");
  const storageIndex = actual.indexOf("storage");
  const functionsIndex = actual.indexOf("functions");

  if (authIndex > databaseIndex || authIndex > storageIndex) {
    addIssue(context, "error", "restore_order.auth", "Auth must be restored before Databases and Storage.", "manifest.json");
  }

  if (functionsIndex < databaseIndex || functionsIndex < storageIndex) {
    addIssue(context, "error", "restore_order.functions", "Functions must be restored after Databases and Storage.", "manifest.json");
  }
}

function validateModuleStatus(context: BackupContext, manifest: BackupManifest): void {
  if (manifest.moduleStatus === undefined) {
    addIssue(context, "warning", "module_status.missing", "Manifest does not include moduleStatus.", "manifest.json");
    return;
  }

  for (const [moduleName, status] of Object.entries(manifest.moduleStatus)) {
    if (status === "failed") {
      addIssue(context, "error", "module_status.failed", `Module ${moduleName} failed during export.`, "manifest.json");
    }

    if (status === "partial") {
      addIssue(context, "warning", "module_status.partial", `Module ${moduleName} exported partially.`, "manifest.json");
    }
  }
}

function validateDocument(context: BackupContext, document: unknown, sourcePath: string): void {
  if (!isObject(document)) {
    addIssue(context, "warning", "database.document_shape", "Document entry has unexpected shape.", sourcePath);
    return;
  }

  validatePermissions(context, document.$permissions, `document ${document.$id ?? "unknown"}`, sourcePath);

  for (const ref of findLikelyFileReferences(document, sourcePath)) {
    if (!context.storageFileIds.has(ref.fileId)) {
      addIssue(context, "warning", "reference.file_missing", `Possible file reference not found in Storage export: ${ref.fileId}.`, ref.path);
    }
  }
}

function validatePermissions(context: BackupContext, permissions: unknown, label: string, sourcePath: string): void {
  if (!Array.isArray(permissions)) {
    return;
  }

  for (const userId of extractUserIdsFromPermissions(permissions)) {
    if (!context.userIds.has(userId)) {
      addIssue(context, "warning", "reference.user_missing", `${label} references missing Auth user ${userId}.`, sourcePath);
    }
  }
}

function validateFunctionEvents(context: BackupContext, events: readonly unknown[], functionId: string): void {
  for (const event of events) {
    if (typeof event !== "string") {
      continue;
    }

    const match = event.match(/^databases\.([^.]+)\.(?:tables|collections)\.([^.]+)\.(?:rows|documents)\./);
    if (match === null) {
      continue;
    }

    const databaseId = match[1];
    const collectionId = match[2];

    if (databaseId === undefined || collectionId === undefined) {
      continue;
    }

    if (!context.databaseIds.has(databaseId)) {
      addIssue(context, "warning", "reference.function_database", `Function ${functionId} event references missing database ${databaseId}.`, "functions/functions.json");
      continue;
    }

    const collectionIds = context.collectionIdsByDatabase.get(databaseId);
    if (collectionIds !== undefined && !collectionIds.has(collectionId)) {
      addIssue(context, "warning", "reference.function_collection", `Function ${functionId} event references missing collection/table ${collectionId}.`, "functions/functions.json");
    }
  }
}

function visitLikelyFileReferences(value: unknown, currentPath: string, refs: Array<{ path: string; fileId: string }>): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) => visitLikelyFileReferences(item, `${currentPath}[${index}]`, refs));
    return;
  }

  if (!isObject(value)) {
    return;
  }

  for (const [key, nestedValue] of Object.entries(value)) {
    const nestedPath = `${currentPath}.${key}`;

    if (isLikelyFileReferenceKey(key)) {
      for (const fileId of normalizeFileReferenceValues(nestedValue)) {
        refs.push({ path: nestedPath, fileId });
      }
      continue;
    }

    visitLikelyFileReferences(nestedValue, nestedPath, refs);
  }
}

function normalizeFileReferenceValues(value: unknown): string[] {
  if (typeof value === "string" && isLikelyAppwriteId(value)) {
    return [value];
  }

  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === "string" && isLikelyAppwriteId(item));
  }

  return [];
}

function isLikelyFileReferenceKey(key: string): boolean {
  return /^(photo|avatar|fileId|fileIds|image|imageId|imageIds|imageUrl|imageUrls|attachment|attachments)$/i.test(key);
}

function isLikelyAppwriteId(value: string): boolean {
  return /^[A-Za-z0-9._-]{8,64}$/.test(value) && !value.startsWith("http");
}

async function readJsonSafe(context: BackupContext, relativePath: string): Promise<unknown> {
  try {
    return await readJson(path.join(/* turbopackIgnore: true */ context.root, relativePath));
  } catch (error) {
    addIssue(context, "error", "json.read_failed", error instanceof Error ? error.message : `Failed to read ${relativePath}.`, relativePath);
    return null;
  }
}

async function readNdjsonSafe(context: BackupContext, relativePath: string): Promise<unknown[]> {
  try {
    return await readNdjson(path.join(/* turbopackIgnore: true */ context.root, relativePath));
  } catch (error) {
    addIssue(context, "error", "ndjson.read_failed", error instanceof Error ? error.message : `Failed to read ${relativePath}.`, relativePath);
    return [];
  }
}

async function readJson(filePath: string): Promise<unknown> {
  const content = await readFile(filePath, "utf8");
  return JSON.parse(content) as unknown;
}

async function readNdjson(filePath: string): Promise<unknown[]> {
  const content = await readFile(filePath, "utf8");
  return content
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as unknown);
}

function compareCount(
  context: BackupContext,
  label: string,
  expected: number | undefined,
  actual: number,
  sourcePath: string,
): void {
  if (expected !== undefined && expected !== actual) {
    addIssue(context, "error", "count.mismatch", `Count mismatch for ${label}: expected ${expected}, found ${actual}.`, sourcePath);
  }
}

function addIssue(
  context: BackupContext,
  severity: ValidationSeverity,
  code: string,
  message: string,
  issuePath?: string,
): void {
  const issue: ValidationIssue = { severity, code, message };
  if (issuePath !== undefined) {
    issue.path = issuePath;
  }
  context.issues.push(issue);
}

function isManifest(value: unknown): value is BackupManifest {
  return (
    isObject(value) &&
    typeof value.formatVersion === "string" &&
    typeof value.exportedAt === "string" &&
    typeof value.endpoint === "string" &&
    typeof value.projectId === "string" &&
    Array.isArray(value.modules) &&
    isObject(value.counts) &&
    Array.isArray(value.restoreOrder) &&
    Array.isArray(value.warnings) &&
    isObject(value.checksums)
  );
}

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null;
}
