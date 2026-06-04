# Contribuir al Appwrite Export Toolkit

Gracias por interesarte en contribuir. Este es un toolkit open source para exportar, validar e importar datos de Appwrite self-hosted. Cualquier ayuda es bienvenida.

## Lo que necesitas tener instalado

- Node.js 20+ (recomendado 22 LTS)
- npm 10+
- Un proyecto Appwrite self-hosted corriendo (para probar cambios)

## Cómo levantar el proyecto

```bash
# Clonar el repo
git clone https://github.com/TU_USUARIO/appwrite-export-toolkit.git
cd appwrite-export-toolkit

# Instalar dependencias
npm install

# Copiar variables de entorno
cp .env.example .env

# Levantar en modo desarrollo
npm run dev
```

El server arranca en `http://localhost:3000`.

## Variables de entorno mínimas

Para que funcione necesitas configurar al menos esto en `.env`:

```env
# Conexión al Appwrite de origen
APPWRITE_ENDPOINT=http://tu-appwrite:80/v1
APPWRITE_API_KEY=tu-api-key
APPWRITE_PROJECT_ID=tu-project-id

# Credenciales de login de la web
APP_LOGIN_USER=admin
APP_LOGIN_PASSWORD=algoseguro

# Dónde se guardan los backups
BACKUP_OUTPUT_DIR=./backups
```

Si querés probar import a otro proyecto, agregá las variables `TARGET_*`.

## Comandos útiles

```bash
npm run dev          # Server con hot reload
npm run build        # Build de producción
npm run lint         # Control de código (eslint)
npm run typecheck    # Chequeo de tipos TypeScript
npm run test         # Correr tests (vitest)
npm run check        # Los tres anteriores juntos
npm run cli -- inspect   # CLI para inspeccionar el proyecto
```

**Antes de mandar un PR, corré `npm run check` y asegurate de que pase sin errores.**

## Estructura del proyecto

```
src/
  app/                  # Next.js App Router (pages y API routes)
    page.tsx            # Página principal (login + dashboard)
    api/
      export/           # POST para iniciar export
      import/           # POST para iniciar import
      schedules/        # CRUD de schedules
      jobs/             # SSE streaming de progreso
      backups/          # Download y eliminación
  components/           # Componentes React (client components)
  server/
    appwrite/           # Conexión con la API de Appwrite
    auth/               # Sesiones y CSRF
    backup/             # Escritura y lectura de backups
    backups/            # Catálogo de backups existentes
    exporters/          # Lógica de exportación por módulo
    import/             # Lógica de importación por módulo
      modules/          # Importadores (auth, databases, storage, etc.)
    inspectors/         # Inspección del proyecto Appwrite
    jobs/               # Streaming SSE y gestión de jobs
    schedules/          # Motor de cron y persistencia
    types/              # Tipos compartidos
    validators/         # Validación de backups
    utils/              # Utilidades (retry, paginación, logging)
  cli/                  # Interfaz de línea de comandos
```

## Convenciones de código

- **TypeScript estricto**. No usamos `any` a menos que sea estrictamente necesario.
- **Zod** para validar inputs externos (API requests, archivos JSON).
- **pino** para logs. No usar `console.log` en código del servidor.
- **NDJSON** para archivos grandes (documents, memberships). JSON normal para metadata.
- **Timing-safe comparison** para comparar tokens y passwords. Nunca usar `===` directo.
- **Spanish** en la UI y en los mensajes de error que ve el usuario.
- **English** en comments del código, JSDoc, y nombres de funciones/variables.

### Formato de código

Usamos el eslint config de Next.js. Si tu editor tiene ESLint configurado, formatea automáticamente. Si no, corré `npm run lint -- --fix`.

## Cómo agregar un módulo de export/import

1. Crear el exporter en `src/server/exporters/tu-modulo-exporter.ts`
2. Crear el importer en `src/server/import/modules/tu-modulo-importer.ts`
3. Registrar ambos en `export-orchestrator.ts` e `import-orchestrator.ts`
4. Agregar el módulo al array `modules` en `parseExportSelection` y `parseImportSelection`
5. Actualizar el panel de UI en `src/components/export-panel.tsx` si hace falta

Mirá los módulos existentes (`auth-exporter.ts`, `database-exporter.ts`) como referencia.

## Cómo agregar tests

Los tests están en `src/**/*.test.ts`. Usamos Vitest.

```bash
npm run test:watch    # Modo watch para desarrollo
```

Si agregás una función nueva, escribí al menos un test que cubra el caso base y un caso edge.

## Proceso de Pull Request

1. Hacé un fork del repo
2. Creá una branch para tu cambio (`git checkout -b fix/algo` o `git checkout -b feature/algo`)
3. Hacé tus cambios
4. Corré `npm run check` y asegurate de que pase
5. Mandá el PR con una descripción clara de qué hace y por qué

### Qué busca el maintainer en un PR

- Que pase lint, typecheck y tests
- Que el cambio tenga sentido (una feature lógica o un fix limpio)
- Que no rompa funcionalidad existente
- Que si es código nuevo, tenga al menos tests básicos

## Issues

Si encontrás un bug, abrí un issue con:
- Qué esperabas que pasara
- Qué pasó realmente
- Cómo reproducirlo (pasos, config, etc.)
- Logs si es posible

Si querés pedir una feature, explicá el caso de uso y por qué te serviría.

## Licencia

Al contribuir, aceptás que tu código se distribuya bajo la licencia GNU GPLv3 de este proyecto.
