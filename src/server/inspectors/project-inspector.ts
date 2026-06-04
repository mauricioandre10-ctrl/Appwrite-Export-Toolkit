import type { AppwriteConfig } from "../appwrite/config";
import type { AppwriteServices } from "../appwrite/client";
import { listAll } from "../utils/pagination";

/** Resultado de la inspección de un proyecto Appwrite, con conteos por servicio y advertencias. */
export type ProjectInspection = {
  endpoint: string;
  projectId: string;
  inspectedAt: string;
  counts: {
    users: number;
    teams: number;
    databases: number;
    buckets: number;
    functions: number;
    providers: number;
  };
  warnings: string[];
};

/**
 * Inspecciona un proyecto Appwrite y obtiene el conteo de cada servicio disponible.
 * @param config - Configuración de conexión al proyecto Appwrite.
 * @param services - Instancias de servicios de Appwrite para listar recursos.
 * @returns Resultado de la inspección con conteos y advertencias.
 */
export async function inspectProject(
  config: AppwriteConfig,
  services: AppwriteServices,
): Promise<ProjectInspection> {
  const warnings = [
    "Secrets and provider credentials are not expected to be recoverable from Appwrite APIs.",
    "Restore order must preserve Auth, Messaging, Databases, Storage, then Functions dependencies.",
  ];

  const [users, teams, databases, buckets, functions, providers] = await Promise.all([
    listAll("users", (queries) => services.users.list(queries)),
    listAll("teams", (queries) => services.teams.list(queries)),
    listAll("databases", (queries) => services.databases.list(queries)),
    listAll("buckets", (queries) => services.storage.listBuckets(queries)),
    listAll("functions", (queries) => services.functions.list(queries)),
    listAll("providers", (queries) => services.messaging.listProviders(queries)),
  ]);

  return {
    endpoint: config.APPWRITE_ENDPOINT,
    projectId: config.APPWRITE_PROJECT_ID,
    inspectedAt: new Date().toISOString(),
    counts: {
      users: users.total,
      teams: teams.total,
      databases: databases.total,
      buckets: buckets.total,
      functions: functions.total,
      providers: providers.total,
    },
    warnings,
  };
}
