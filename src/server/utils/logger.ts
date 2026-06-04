import pino from "pino";

/**
 * Logger global de la aplicación (pino). Redacta automáticamente API keys y secrets.
 */
export const logger = pino({
  level: process.env.LOG_LEVEL ?? "info",
  redact: {
    paths: ["APPWRITE_API_KEY", "APPWRITE_TARGET_API_KEY", "*.APPWRITE_API_KEY", "*.APPWRITE_TARGET_API_KEY"],
    remove: true,
  },
});
