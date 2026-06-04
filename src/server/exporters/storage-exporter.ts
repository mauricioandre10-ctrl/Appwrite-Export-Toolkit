import type { AppwriteServices } from "../appwrite/client";
import type { AppwriteConfig } from "../appwrite/config";
import { downloadStorageFile } from "../appwrite/http-download";
import type { BackupWriter } from "../backup/backup-writer";
import { listAll, paginateRows } from "../utils/pagination";
import type { JsonObject, ModuleExportResult } from "./types";

const MIME_TO_EXT: Record<string, string> = {
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/gif": ".gif",
  "image/webp": ".webp",
  "image/svg+xml": ".svg",
  "image/bmp": ".bmp",
  "image/tiff": ".tiff",
  "image/avif": ".avif",
  "application/pdf": ".pdf",
  "application/json": ".json",
  "text/plain": ".txt",
  "text/csv": ".csv",
  "video/mp4": ".mp4",
  "video/webm": ".webm",
  "audio/mpeg": ".mp3",
  "audio/wav": ".wav",
  "application/zip": ".zip",
  "application/octet-stream": ".bin",
};

function extForMime(mimeType: string | undefined): string {
  if (!mimeType) return "";
  return MIME_TO_EXT[mimeType] ?? `.${mimeType.split("/").pop() ?? "bin"}`;
}

/** Exporta buckets, archivos y blobs de Storage, descargando cada archivo y registrando su checksum. */
export async function exportStorage(config: AppwriteConfig, services: AppwriteServices, writer: BackupWriter): Promise<ModuleExportResult> {
  await writer.ensureDir("storage");

  const buckets = await listAll("buckets", (queries) => services.storage.listBuckets(queries));
  const files: string[] = [];
  const bucketMetadata = [];
  const warnings = [
    "Storage file IDs should be preserved during restore, otherwise database file references need ID remapping.",
    "File permissions can reference Auth users and must be restored after Auth.",
  ];
  let fileCount = 0;
  let downloadedFiles = 0;
  let failedDownloads = 0;
  let totalSizeOriginal = 0;

  for (const bucket of buckets.rows) {
    const bucketId = String(bucket.$id);
    await writer.ensureDir(`storage/bucket_${bucketId}/blobs`);

    bucketMetadata.push({
      bucket,
    });

    files.push(
      await writer.writeNdjsonStream(`storage/bucket_${bucketId}/files.ndjson`, async (append) => {
        for await (const page of paginateRows("files", (queries) => services.storage.listFiles(bucketId, queries))) {
          fileCount += page.rows.length;
          for (const file of page.rows) {
            const fileId = String(file.$id);
            const ext = extForMime(file.mimeType as string | undefined);
            const blobPath = `storage/bucket_${bucketId}/blobs/${fileId}${ext}`;
            const fileMeta: JsonObject = { ...file, blobPath, blobSha256: null, blobBytes: null, downloadError: null };
            totalSizeOriginal += Number(file.sizeOriginal ?? 0);

            try {
              const download = await downloadStorageFile({
                config,
                bucketId,
                fileId,
                outputPath: writer.resolvePath(blobPath),
              });
              fileMeta.blobSha256 = download.sha256;
              fileMeta.blobBytes = download.bytes;
              downloadedFiles += 1;
            } catch (error) {
              const message = error instanceof Error ? error.message : "Unknown storage download error";
              fileMeta.downloadError = message;
              failedDownloads += 1;
              warnings.push(`Failed to download storage file ${bucketId}/${fileId}: ${message}`);
            }

            await append(fileMeta);
          }
        }
      }),
    );
  }

  files.push(await writer.writeJson("storage/buckets.json", bucketMetadata));
  files.push(
    await writer.writeJson("storage/meta.json", {
      exportedAt: new Date().toISOString(),
      counts: {
        buckets: buckets.total,
        files: fileCount,
        downloadedFiles,
        failedDownloads,
        totalSizeOriginal,
      },
      warnings,
    }),
  );

  return {
    module: "storage",
    status: failedDownloads > 0 ? "partial" : "complete",
    counts: {
      buckets: buckets.total,
      files: fileCount,
    },
    warnings,
    files,
  };
}
