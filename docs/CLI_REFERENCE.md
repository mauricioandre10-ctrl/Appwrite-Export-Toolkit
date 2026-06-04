# Referencia de la CLI

El toolkit incluye una interfaz de línea de comandos para operaciones directas desde la terminal. Es útil para automatización, scripts, y cuando preferís no usar la web.

## Cómo ejecutar

```bash
npm run cli -- [comando] [opciones]
```

O directamente con tsx:

```bash
npx tsx src/cli/index.ts [comando] [opciones]
```

---

## Comandos

### inspect

Conecta al Appwrite configurado y muestra un resumen del proyecto: usuarios, teams, databases, buckets, functions, etc.

```bash
npm run cli -- inspect
```

**Salida:** JSON con la inspección completa del proyecto.

**Ejemplo de uso:** Quiero ver qué hay en mi proyecto antes de exportar.

---

### export

Exporta datos del proyecto Appwrite configurado a `BACKUP_OUTPUT_DIR`.

```bash
# Exportar todo
npm run cli -- export all

# Exportar solo un módulo
npm run cli -- export auth
npm run cli -- export databases
npm run cli -- export storage
```

**Argumentos:**

| Argumento | Valores posibles | Default | Descripción |
|-----------|------------------|---------|-------------|
| `[module]` | `all`, `auth`, `databases`, `storage` | `all` | Qué módulos exportar |

**Salida:** JSON con el resumen de la exportación (backupId, rutas, conteos, checksums).

**Ejemplo de uso:** `npm run cli -- export databases` para exportar solo las bases de datos.

---

### validate

Valida la estructura, checksums, blobs y referencias cruzadas de un backup existente.

```bash
npm run cli -- validate ./backups/backup-2026-01-15T10-30-00Z
```

**Argumentos:**

| Argumento | Requerido | Descripción |
|-----------|-----------|-------------|
| `<backupPath>` | Sí | Ruta al directorio del backup (debe contener `manifest.json`) |

**Salida:** JSON con el resultado de la validación:
```json
{
  "ok": true,
  "issues": [],
  "summary": {
    "filesChecked": 45,
    "blobsChecked": 280,
    "checksumsMatched": 280
  }
}
```

Si `ok` es `false`, el código de salida es 1. Útil para scripts.

**Ejemplo de uso:** Después de un backup, validá la integridad: `npm run cli -- validate ./backups/backup-xxx`

---

### import

Importa un backup a la instancia de Appwrite configurada como target.

```bash
# Importar todo
npm run cli -- import all --backup ./backups/backup-2026-01-15T10-30-00Z

# Importar solo un módulo
npm run cli -- import databases --backup ./backups/backup-2026-01-15T10-30-00Z
```

**Argumentos:**

| Argumento | Valores posibles | Default | Descripción |
|-----------|------------------|---------|-------------|
| `[module]` | `all`, `auth`, `databases`, `storage` | `all` | Qué módulos importar |

**Opciones:**

| Opción | Requerido | Descripción |
|--------|-----------|-------------|
| `--backup <path>` | Sí | Ruta al directorio del backup |

**Salida:** JSON con el resultado de la importación (status, módulos creados, errores).

Si el import falla, el código de salida es 1.

**Ejemplo de uso:** `npm run cli -- import all --backup ./backups/backup-xxx`

---

### delete

Elimina un backup permanentemente. Tiene protección de dos pasos: primero muestra la info, y tenés que confirmar.

```bash
# Primer paso: ver la info
npm run cli -- delete backup-2026-01-15T10-30-00Z

# Segundo paso: confirmar eliminación
npm run cli -- delete backup-2026-01-15T10-30-00Z --confirm
```

**Argumentos:**

| Argumento | Requerido | Descripción |
|-----------|-----------|-------------|
| `<backupId>` | Sí | Nombre del directorio del backup |

**Opciones:**

| Opción | Descripción |
|--------|-------------|
| `--confirm` | Salta la confirmación y elimina directamente |

**Sin `--confirm`:** Muestra info del backup (fecha, proyecto, módulos, tamaño) y pede que confirmes.

**Con `--confirm`:** Elimina el backup y todos sus archivos.

**Ejemplo de uso:**
```bash
npm run cli -- delete backup-2026-01-15T10-30-00Z
# Te muestra la info
npm run cli -- delete backup-2026-01-15T10-30-00Z --confirm
# Lo elimina
```

---

## Variables de entorno para la CLI

La CLI usa las mismas variables de entorno que la web app. Para exportar necesitás las variables de origen, para importar las de target.

```env
# Origen (para export e inspect)
APPWRITE_ENDPOINT=http://tu-appwrite:80/v1
APPWRITE_API_KEY=tu-api-key
APPWRITE_PROJECT_ID=tu-project-id

# Target (para import)
TARGET_ENDPOINT=http://otro-appwrite:80/v1
TARGET_API_KEY=otra-api-key
TARGET_PROJECT_ID=otro-project-id

# Dónde se guardan/leen los backups
BACKUP_OUTPUT_DIR=./backups
```

---

## Uso en scripts

La CLI está pensada para usar en scripts de automatización:

```bash
#!/bin/bash
# Script de backup diario

# Exportar
npm run cli -- export all 2>&1 | tee /var/log/backup-export.log

# Validar el último backup
LATEST=$(ls -td ./backups/backup-* | head -1)
npm run cli -- validate "$LATEST"

if [ $? -eq 0 ]; then
  echo "Backup válido"
else
  echo "Backup con errores" >&2
  exit 1
fi
```
