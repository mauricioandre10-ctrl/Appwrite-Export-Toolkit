import { Client, Databases, Functions, Messaging, Storage, Teams, Users } from "node-appwrite";

import type { AppwriteConfig } from "./config";

/** Servicios del SDK de Appwrite inicializados con las credenciales de configuración. */
export type AppwriteServices = {
  client: Client;
  databases: Databases;
  functions: Functions;
  messaging: Messaging;
  storage: Storage;
  teams: Teams;
  users: Users;
};

/**
 * Crea y devuelve una instancia de cada servicio del SDK de Appwrite listos para usar.
 *
 * Inicializa un `Client` con las credenciales de configuración y construye
 * todas las instancias de servicio (Databases, Functions, Storage, etc.) ligadas
 * a ese mismo cliente.
 *
 * @param config - Objeto con las credenciales: `APPWRITE_ENDPOINT`, `APPWRITE_PROJECT_ID` y `APPWRITE_API_KEY`.
 * @returns Objeto con todas las instancias de servicio listas para usar.
 *
 * @errors
 * - No valida las credenciales al crear las instancias. Los errores de autenticación
 *   se producen al hacer la primera llamada a cada servicio.
 *
 * @edge-cases
 * - Cada llamada crea un `Client` nuevo; no hay singleton.
 * - Las instancias de servicio comparten el mismo `Client` subyacente.
 */
export function createAppwriteServices(config: AppwriteConfig): AppwriteServices {
  const client = new Client()
    .setEndpoint(config.APPWRITE_ENDPOINT)
    .setProject(config.APPWRITE_PROJECT_ID)
    .setKey(config.APPWRITE_API_KEY);

  return {
    client,
    databases: new Databases(client),
    functions: new Functions(client),
    messaging: new Messaging(client),
    storage: new Storage(client),
    teams: new Teams(client),
    users: new Users(client),
  };
}
