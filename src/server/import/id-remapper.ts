import { readFile } from "node:fs/promises";
import path from "node:path";

export type IdMapping = {
  source: string;
  destination: string;
  type: "user" | "team" | "database" | "collection" | "bucket" | "function" | "topic" | "document" | "provider";
};

export type IdRemapStore = {
  mappings: IdMapping[];
  createdAt: string;
};

export class IdRemapper {
  private mappings: Map<string, Map<string, string>> = new Map();

  addMapping(type: IdMapping["type"], sourceId: string, destinationId: string): void {
    if (!this.mappings.has(type)) {
      this.mappings.set(type, new Map());
    }
    this.mappings.get(type)!.set(sourceId, destinationId);
  }

  getDestination(type: IdMapping["type"], sourceId: string): string | undefined {
    return this.mappings.get(type)?.get(sourceId);
  }

  removeMapping(type: IdMapping["type"], sourceId: string): void {
    this.mappings.get(type)?.delete(sourceId);
  }

  getSource(type: IdMapping["type"], destinationId: string): string | undefined {
    const typeMap = this.mappings.get(type);
    if (!typeMap) return undefined;
    for (const [source, dest] of typeMap) {
      if (dest === destinationId) return source;
    }
    return undefined;
  }

  getAll(type: IdMapping["type"]): Map<string, string> {
    return this.mappings.get(type) ?? new Map();
  }

  async save(backupRoot: string): Promise<void> {
    const store: IdRemapStore = {
      mappings: [],
      createdAt: new Date().toISOString(),
    };

    for (const [type, typeMap] of this.mappings) {
      for (const [source, destination] of typeMap) {
        store.mappings.push({ source, destination, type: type as IdMapping["type"] });
      }
    }

    const filePath = path.join(backupRoot, "import-id-mappings.json");
    const { writeFile } = await import("node:fs/promises");
    await writeFile(filePath, JSON.stringify(store, null, 2), "utf8");
  }

  static async load(backupRoot: string): Promise<IdRemapper> {
    const remapper = new IdRemapper();
    try {
      const content = await readFile(path.join(backupRoot, "import-id-mappings.json"), "utf8");
      const store = JSON.parse(content) as IdRemapStore;
      for (const mapping of store.mappings) {
        remapper.addMapping(mapping.type, mapping.source, mapping.destination);
      }
    } catch {
      // No existing mappings
    }
    return remapper;
  }
}

export function remapText(text: string, remapper: IdRemapper): string {
  let result = text;

  for (const [sourceId, destId] of remapper.getAll("user")) {
    result = result.replaceAll(`user:${sourceId}`, `user:${destId}`);
    result = result.replaceAll(`"userId":"${sourceId}"`, `"userId":"${destId}"`);
  }

  for (const [sourceId, destId] of remapper.getAll("team")) {
    result = result.replaceAll(`team:${sourceId}`, `team:${destId}`);
  }

  return result;
}
