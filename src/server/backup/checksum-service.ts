import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readdir } from "node:fs/promises";
import path from "node:path";

/**
 * Calcula el hash SHA-256 de un archivo en disco y lo devuelve como hex.
 *
 * Usa un stream de lectura (`createReadStream`) para procesar el archivo por chunks,
 * lo que permite manejar archivos de cualquier tamaño sin cargarlos completamente en memoria.
 *
 * @param filePath - Ruta absoluta o relativa del archivo a hashear.
 * @returns El hash SHA-256 en formato hexadecimal (64 caracteres).
 * @throws Si el archivo no existe, no es legible o ocurre un error de I/O durante la lectura.
 */
export async function sha256File(filePath: string): Promise<string> {
  const hash = createHash("sha256");
  const stream = createReadStream(filePath);

  for await (const chunk of stream) {
    hash.update(chunk);
  }

  return hash.digest("hex");
}

/**
 * Calcula el hash SHA-256 de un string y lo devuelve como hex.
 *
 * Función síncrona que convierte el string a bytes UTF-8 antes de hashear.
 * Ideal para generar checksums de datos en memoria (no de archivos en disco).
 *
 * @param value - String a hashear. Se codifica como UTF-8 internamente.
 * @returns Hash SHA-256 en formato hexadecimal (64 caracteres exactos).
 *
 * @edge-cases
 * - String vacío devuelve un hash válido y constante.
 * - Strings con caracteres multibyte (emojis, tildes) se procesan correctamente.
 */
export function sha256String(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

/**
 * Recorre recursivamente un directorio y calcula el checksum SHA-256 de cada archivo.
 *
 * Excluye `manifest.json` del resultado. Las claves del objeto retornado son las rutas
 * relativas al `rootDir` con separadores `/`, y los valores son los hashes hexadecimales.
 *
 * @param rootDir - Directorio raíz desde donde se inicia la traversión recursiva.
 * @returns Un `Record<string, string>` donde la clave es la ruta relativa del archivo
 *   (con separadores `/`) y el valor es su hash SHA-256 en hex.
 * @throws Si el directorio no existe, no es legible, o si falla el cálculo de hash de algún archivo.
 */
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
