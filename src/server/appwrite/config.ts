import "dotenv/config";

import { z } from "zod";

const envSchema = z.object({
  APPWRITE_ENDPOINT: z.string().url(),
  APPWRITE_PROJECT_ID: z.string().min(1),
  APPWRITE_API_KEY: z.string().min(1),
  APPWRITE_TARGET_ENDPOINT: z.string().url().optional().or(z.literal("")),
  APPWRITE_TARGET_PROJECT_ID: z.string().optional(),
  APPWRITE_TARGET_API_KEY: z.string().optional(),
  BACKUP_OUTPUT_DIR: z.string().min(1).default("./backups"),
  BACKUP_FORMAT_VERSION: z.string().min(1).default("1.0.0"),
});

export type AppwriteConfig = z.infer<typeof envSchema>;

export function loadAppwriteConfig(): AppwriteConfig {
  const result = envSchema.safeParse(process.env);

  if (!result.success) {
    const issues = result.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ");
    throw new Error(`Invalid Appwrite environment config: ${issues}`);
  }

  return result.data;
}
