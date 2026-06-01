import { Client, Databases, Functions, Messaging, Storage, Teams, Users } from "node-appwrite";

import type { AppwriteConfig } from "./config";

export type AppwriteServices = {
  client: Client;
  databases: Databases;
  functions: Functions;
  messaging: Messaging;
  storage: Storage;
  teams: Teams;
  users: Users;
};

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
