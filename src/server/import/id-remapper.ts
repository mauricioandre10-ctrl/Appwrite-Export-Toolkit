import { readFile } from "node:fs/promises";
import path from "node:path";

/** Mapeo de un ID de origen a su equivalente en el destino, usado durante la importación. */
export type IdMapping = {
  /** ID del recurso en el servidor de origen. */
  source: string;
  /** ID del recurso en el servidor de destino (asignado tras la creación). */
  destination: string;
  /** Tipo de recurso al que pertenece el mapeo. */
  type: "user" | "team" | "database" | "collection" | "bucket" | "function" | "topic" | "document" | "provider";
};

/** Almacén serializable de todos los mapeos de IDs generados durante una importación. */
export type IdRemapStore = {
  /** Lista de todos los mapeos de IDs. */
  mappings: IdMapping[];
  /** Timestamp ISO 8601 de cuándo se creó el almacén. */
  createdAt: string;
};

/**
 * Mapa bidireccional para reasignar IDs durante la importación.
 *
 * Almacena los mapeos entre IDs del servidor de origen (old) y los IDs
 * generados en el servidor de destino (new), agrupados por tipo de recurso.
 * Permite consultas en ambas direcciones para resolver referencias cruzadas
 * durante el proceso de importación.
 *
 * Se puede serializar a disco con {@link save} y restaurar con {@link IdRemapper.load}.
 */
export class IdRemapper {
  private mappings: Map<string, Map<string, string>> = new Map();

  /**
   * Agrega un mapeo entre un ID de origen y un ID de destino para un tipo de recurso dado.
   *
   * Si ya existía un mapeo para el mismo sourceId, se sobrescribe.
   *
   * @param type - Tipo de recurso (user, database, collection, etc.).
   * @param sourceId - ID del recurso en el servidor de origen.
   * @param destinationId - ID asignado en el servidor de destino.
   */
  addMapping(type: IdMapping["type"], sourceId: string, destinationId: string): void {
    if (!this.mappings.has(type)) {
      this.mappings.set(type, new Map());
    }
    this.mappings.get(type)!.set(sourceId, destinationId);
  }

  /**
   * Busca el ID de destino correspondiente a un ID de origen.
   *
   * @param type - Tipo de recurso a buscar.
   * @param sourceId - ID del recurso en el servidor de origen.
   * @returns El ID de destino si existe el mapeo, o `undefined` si no se encontró.
   */
  getDestination(type: IdMapping["type"], sourceId: string): string | undefined {
    return this.mappings.get(type)?.get(sourceId);
  }

  /**
   * Elimina el mapeo asociado a un ID de origen para un tipo de recurso.
   *
   * @param type - Tipo de recurso del mapeo a eliminar.
   * @param sourceId - ID del recurso en el servidor de origen a quitar.
   */
  removeMapping(type: IdMapping["type"], sourceId: string): void {
    this.mappings.get(type)?.delete(sourceId);
  }

  /**
   * Busca el ID de origen correspondiente a un ID de destino (inverso).
   *
   * Realiza un recorrido lineal O(n) sobre los mapeos del tipo indicado
   * para encontrar el sourceId que corresponde al destinationId dado.
   *
   * @param type - Tipo de recurso a buscar.
   * @param destinationId - ID del recurso en el servidor de destino.
   * @returns El ID de origen si existe el mapeo, o `undefined` si no se encontró.
   */
  getSource(type: IdMapping["type"], destinationId: string): string | undefined {
    const typeMap = this.mappings.get(type);
    if (!typeMap) return undefined;
    for (const [source, dest] of typeMap) {
      if (dest === destinationId) return source;
    }
    return undefined;
  }

  /**
   * Devuelve todos los mapeos de un tipo de recurso.
   *
   * @param type - Tipo de recurso cuyos mapeos se quieren obtener.
   * @returns Mapa de sourceId → destinationId. Si no hay mapeos para el tipo, devuelve un Map vacío.
   */
  getAll(type: IdMapping["type"]): Map<string, string> {
    return this.mappings.get(type) ?? new Map();
  }

  /**
   * Serializa todos los mapeos de IDs a un archivo JSON en disco.
   *
   * Escribe un archivo `import-id-mappings.json` en la raíz del backup
   * con todos los mapeos acumulados (source → destination) agrupados por tipo.
   * El archivo incluye un timestamp de creación (`createdAt`) para referencia.
   *
   * El archivo sobrescribe cualquier versión previa del mismo.
   *
   * @param backupRoot - Ruta al directorio raíz del backup donde se escribirá el archivo.
   * @returns Promise que se resuelve al completar la escritura del archivo.
   */
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

  /**
   * Carga un IdRemapper desde un archivo de mapeos persistido en disco.
   *
   * Intenta leer el archivo `import-id-mappings.json` de la raíz del backup.
   * Si el archivo no existe, no es válido JSON o falla por cualquier motivo,
   * devuelve un IdRemapper vacío sin lanzar excepciones.
   *
   * @param backupRoot - Ruta al directorio raíz del backup que contiene el archivo de mapeos.
   * @returns Promise que se resuelve con un IdRemapper (con los mappings cargados o vacío).
   */
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

/**
 * Reemplaza referencias a IDs de usuarios y teams en un texto usando los mapeos del remapper.
 *
 * Busca y reemplaza patrones del tipo `user:<sourceId>` y `team:<sourceId>` con
 * sus IDs destino correspondientes. Para usuarios, también reemplaza el patrón
 * JSON `"userId":"<sourceId>"` por `"userId":"<destId>"`.
 *
 * La función es útil para traducir IDs en documentos exportados, URLs de archivos,
 * permisos u otros campos de texto que contengan referencias a usuarios o teams
 * originales.
 *
 * @param text - Texto de entrada donde se realizarán los reemplazos.
 * @param remapper - Instancia de IdRemapper con los mapeos de user y team cargados.
 * @returns El texto con todas las referencias a IDs originales reemplazadas por los IDs destino.
 */
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
