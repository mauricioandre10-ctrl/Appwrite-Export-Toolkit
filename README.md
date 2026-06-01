# Appwrite Export Toolkit

Structured export, validation, and restore toolkit for Appwrite self-hosted projects.

The project starts with Appwrite `1.8.x` support and focuses on logical backups: Auth, Databases, Storage, Functions, Messaging, manifests and checksums.

## Current Stack

- Next.js `16` for the web panel.
- React `19`.
- TypeScript strict.
- Node.js backend/core modules under `src/server`.
- CLI under `src/cli`.
- Appwrite Server SDK pinned to the `1.8.x` API line.
- Zod for environment validation.
- Vitest for tests.

## Local Development

Install dependencies:

```bash
npm install
```

Run the web app:

```bash
npm run dev
```

Run the CLI inspection:

```bash
npm run cli -- inspect
```

Run quality checks:

```bash
npm run lint
npm run typecheck
npm run test
npm run build
```

## Environment

Copy `.env.example` to `.env` for local development and set your Appwrite values.

Required:

```env
APPWRITE_ENDPOINT=https://your-appwrite.example.com/v1
APPWRITE_PROJECT_ID=your_project_id
APPWRITE_API_KEY=your_api_key
BACKUP_OUTPUT_DIR=/data/backups
BACKUP_FORMAT_VERSION=1.0.0
```

For local development, `BACKUP_OUTPUT_DIR=./backups` is also valid.

## Persistent Exports

Production deployments should mount a persistent volume at:

```text
/data
```

Exports are written to:

```text
/data/backups
```

This keeps generated backups alive across container restarts and redeploys.

## Docker

Build and run locally:

```bash
docker compose up --build
```

The included compose file mounts a named volume at `/data`.

For EasyPanel or Docploy, deploy from GitHub using the included `Dockerfile`, expose port `3000`, and mount persistent storage at `/data`.

See `DEPLOYMENT.md` for deployment details.

## Restore Order Rule

Restore order is critical and not optional:

1. Auth.
2. Messaging providers and credentials placeholders.
3. Database schema.
4. Storage buckets and files.
5. Documents.
6. Functions.
7. Final validation.

This matters because documents can contain `user:<id>` permissions, database rows can reference Storage file IDs, and Functions can depend on Databases, Messaging and secrets.
