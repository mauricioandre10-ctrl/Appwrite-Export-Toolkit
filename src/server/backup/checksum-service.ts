import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readdir } from "node:fs/promises";
import path from "node:path";

/** Calcula el hash SHA-256 de un archivo en disco y lo devuelve como hex. */
export async function sha256File(filePath: string): Promise<string> {
  const hash = createHash("sha256");
  const stream = createReadStream(filePath);

  for await (const chunk of stream) {
    hash.update(chunk);
  }

  return hash.digest("hex");
}

/** Calcula el hash SHA-256 de un string y lo devuelve como hex. */
export function sha256String(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

/** Recorre recursivamente un directorio y devuelve los checksums SHA-256 de cada archivo, excluyendo manifest.json. */
export async function collectFileChecksums(rootDir: string): Promise<Record<string, string>> {
  const checksums: Record<string, string> = {};

  for (const filePath of await listFilesRecursive(rootDir)) {
    const relativePath = path.relative(rootDir, filePath).split(path.sep).join("/");

    if (relativePath === "manifest.json") {
      continue;
    }

    checksums[relativePath] = await sha256File(filePath);
  }

  return checksums;
}

async function listFilesRecursive(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const entryPath = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        return listFilesRecursive(entryPath);
      }

      return [entryPath];
    }),
  );

  return files.flat();
}
