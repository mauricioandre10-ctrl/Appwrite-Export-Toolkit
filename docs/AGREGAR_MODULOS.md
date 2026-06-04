# Agregar Modulos de Export/Import

Guia paso a paso para agregar un nuevo modulo (ej: `functions`, `messaging`).

## Paso 1: Crear el exporter

Crea `src/server/exporters/functions-exporter.ts`:

```typescript
import type { AppwriteServices } from "../appwrite/client";
import type { BackupWriter } from "../backup/backup-writer";
import { listAll } from "../utils/pagination";
import type { ModuleExportResult } from "./types";

export async function exportFunctions(
  services: AppwriteServices,
  writer: BackupWriter,
): Promise<ModuleExportResult> {
  await writer.ensureDir("functions");

  const functions = await listAll("functions", (queries) =>
    services.functions.list(queries),
  );

  const warnings: string[] = [];
  const files: string[] = [];

  // Exportar cada funcion con su contenido
  for (const fn of functions.rows) {
    if (typeof fn.$id !== "string") continue;

    // Listar deployments de cada funcion
    const deployments = await listAll("deployments", (queries) =>
      services.functions.listDeployments(fn.$id, queries),
    );

    // Guardar metadata
    files.push(
      await writer.writeJson(`functions/${fn.$id}.json`, {
        ...fn,
        deployments: deployments.rows,
      }),
    );
  }

  files.push(
    await writer.writeNdjson(
      "functions/index.ndjson",
      functions.rows,
    ),
  );

  return {
    module: "functions",
    status: warnings.length > 0 ? "partial" : "complete",
    counts: { functions: functions.total },
    warnings,
    files,
  };
}
```

## Paso 2: Crear el importer

Crea `src/server/import/modules/functions-importer.ts`:

```typescript
import type { AppwriteServices } from "../../appwrite/client";
import type { IdRemapper } from "../id-remapper";
import type { ImportModuleResult } from "./auth-importer";

export async function importFunctions(
  services: AppwriteServices,
  backupRoot: string,
  remapper: IdRemapper,
): Promise<ImportModuleResult> {
  const result: ImportModuleResult = {
    module: "functions",
    status: "complete",
    created: 0,
    skipped: 0,
    errors: [],
  };

  try {
    const { readFile } = await import("node:fs/promises");
    const path = await import("node:path");

    const indexFile = path.join(backupRoot, "functions", "index.ndjson");
    let content: string;
    try {
      content = await readFile(indexFile, "utf8");
    } catch {
      return result;
    }

    const lines = content.split("\n").filter((l) => l.trim().length > 0);

    for (const line of lines) {
      try {
        const fn = JSON.parse(line) as Record<string, unknown>;
        const sourceId = String(fn.$id ?? "");

        // Verificar si ya fue remapeado
        const existing = remapper.getDestination("function", sourceId);
        if (existing) {
          result.skipped += 1;
          continue;
        }

        // Crear la funcion en el destino
        const created = await services.functions.create({
          name: String(fn.name ?? "Unnamed"),
          // ... otros campos
        });

        remapper.addMapping("function", sourceId, created.$id);
        result.created += 1;
      } catch (error) {
        const msg = error instanceof Error ? error.message : "Unknown";
        result.errors.push(`Function: ${msg}`);
        result.status = "partial";
      }
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Unknown";
    result.errors.push(`Functions import failed: ${msg}`);
    result.status = "failed";
  }

  return result;
}
```

## Paso 3: Registrar en los orquestradores

### export-orchestrator.ts

```typescript
// Agregar al array de modulos exportables
export const exportableModules = ["auth", "databases", "storage", "functions"] as const;

// Importar la funcion
import { exportFunctions } from "./functions-exporter";

// Agregar al switch en runModuleExport
case "functions":
  return exportFunctions(services, writer);

// Actualizar pesos para el progreso
const EXPORT_WEIGHTS: Record<string, number> = {
  auth: 15,
  databases: 45,
  storage: 20,
  functions: 20,
};
```

### import-orchestrator.ts

```typescript
// Actualizar el orden de restore
const RESTORE_ORDER = ["auth", "databases", "storage", "functions"];

// Importar la funcion
import { importFunctions } from "./modules/functions-importer";

// Agregar al switch en importBackup
case "functions":
  moduleResult = await importFunctions(services, backupRoot, remapper);
  break;
```

## Paso 4: Actualizar parseExportSelection y parseImportSelection

En `export-orchestrator.ts`:

```typescript
export function parseExportSelection(value: string | undefined): ExportSelection {
  if (value === undefined || value === "all") return "all";
  if (isExportableModule(value)) return value;
  throw new Error(
    `Invalid export module "${value}". Use one of: all, ${exportableModules.join(", ")}`,
  );
}
```

En `import-orchestrator.ts`:

```typescript
export function parseImportSelection(input: string): ImportSelection {
  if (input === "all") {
    return { modules: [...RESTORE_ORDER] };
  }
  const modules = input
    .split(",")
    .map((m) => m.trim().toLowerCase())
    .filter((m) => RESTORE_ORDER.includes(m));
  return { modules: modules.length > 0 ? modules : [...RESTORE_ORDER] };
}
```

## Paso 5: Actualizar la UI (si es necesario)

Si quieres que el modulo aparezca en el panel de export/import, actualiza:

- `src/components/export-panel.tsx` - opciones de modulo
- `src/components/import-panel.tsx` - opciones de modulo
- `src/app/page.tsx` - metricas del dashboard

## Paso 6: Agregar tests

Crea `src/server/import/modules/functions-importer.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { importFunctions } from "./functions-importer";
// ... tests
```

## Uso del IdRemapper

El `IdRemapper` es critico para imports. Cuando creas un recurso en el destino, Appwrite genera un nuevo ID. El remapper almacena la relacion `sourceId -> destinationId` para que otros modulos puedan referenciar los IDs correctos.

```typescript
// Al crear un usuario
const created = await services.users.create({ userId: sourceId, ... });
remapper.addMapping("user", sourceId, created.$id);

// Al necesitar el ID mapeado en otro modulo
const destUserId = remapper.getDestination("user", sourceUserId);
```

El remapper se persiste en `import-id-mappings.json` al finalizar el import.

## Orden de restore

El orden importa porque hay dependencias:

1. **auth** - Users, teams, memberships (otras cosas dependen de users)
2. **databases** - Collections, documents
3. **storage** - Buckets, files

Si agregas `functions` o `messaging`, ponlos despues de `databases` y antes de `storage` si dependen de datos de DB.

## Tips

- Usa `paginateRows()` de `src/server/utils/pagination.ts` para listar con auto-paginacion
- El `BackupWriter` tiene proteccion contra path traversal - siempre usa rutas relativas
- Los warnings se acumulan en el array `warnings` del `ModuleExportResult`
- El status puede ser `complete`, `partial` (algunos items fallaron) o `failed`
- Logea errores con pino: `log.error({ module: "functions", ... }, "message")`
