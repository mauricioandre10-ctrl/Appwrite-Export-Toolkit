import { createWriteStream } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { once } from "node:events";

import { stringifyJson, stringifyNdjson } from "../utils/json";

export class BackupWriter {
  constructor(private readonly rootDir: string) {}

  resolvePath(relativePath: string): string {
    const resolved = path.resolve(this.rootDir, relativePath);
    if (!resolved.startsWith(this.rootDir)) {
      throw new Error(`Path traversal attempt blocked: ${relativePath}`);
    }
    return resolved;
  }

  async ensureDir(relativeDir = "."): Promise<string> {
    const dir = this.resolvePath(relativeDir);
    await mkdir(dir, { recursive: true });
    return dir;
  }

  async writeJson(relativePath: string, value: unknown): Promise<string> {
    const filePath = this.resolvePath(relativePath);
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, stringifyJson(value), "utf8");
    return filePath;
  }

  async writeNdjson(relativePath: string, rows: readonly unknown[]): Promise<string> {
    const filePath = this.resolvePath(relativePath);
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, rows.map((row) => stringifyNdjson(row)).join(""), "utf8");
    return filePath;
  }

  async writeNdjsonStream(
    relativePath: string,
    writeRows: (append: (row: unknown) => Promise<void>) => Promise<void>,
  ): Promise<string> {
    const filePath = this.resolvePath(relativePath);
    await mkdir(path.dirname(filePath), { recursive: true });

    const stream = createWriteStream(filePath, { encoding: "utf8" });

    try {
      await writeRows(async (row) => {
        if (!stream.write(stringifyNdjson(row))) {
          await once(stream, "drain");
        }
      });
    } finally {
      stream.end();
      await once(stream, "finish");
    }

    return filePath;
  }

  async writeBinary(relativePath: string, data: ArrayBuffer): Promise<string> {
    const filePath = this.resolvePath(relativePath);
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, Buffer.from(data));
    return filePath;
  }
}
