import type { AppwriteServices } from "../appwrite/client";
import type { BackupWriter } from "../backup/backup-writer";
import { listAll, paginateRows } from "../utils/pagination";
import { isObject, omitSensitiveFields } from "./sanitize";
import type { JsonObject, ModuleExportResult } from "./types";

export async function exportAuth(services: AppwriteServices, writer: BackupWriter): Promise<ModuleExportResult> {
  await writer.ensureDir("auth");

  const teams = await listAll("teams", (queries) => services.teams.list(queries));
  const memberships: unknown[] = [];
  const targets: unknown[] = [];
  let userCount = 0;
  const warnings = [
    "Auth password hashes and password fields are redacted from this export.",
    "Push targets are operational device data and may not be valid after restore.",
  ];

  for (const team of teams.rows) {
    if (!isObject(team) || typeof team.$id !== "string") {
      continue;
    }

    const teamMemberships = await listAll("memberships", (queries) => services.teams.listMemberships(team.$id as string, queries));
    memberships.push(...teamMemberships.rows.map((membership) => ({ teamId: team.$id, ...safeObject(membership) })));
  }

  const safeTeams = teams.rows.map((team) => omitSensitiveFields(team));

  const files = [
    await writer.writeNdjsonStream("auth/users.ndjson", async (append) => {
      for await (const page of paginateRows("users", (queries) => services.users.list(queries))) {
        userCount += page.rows.length;

        for (const user of page.rows) {
          if (isObject(user) && Array.isArray(user.targets)) {
            for (const target of user.targets) {
              targets.push({ userId: user.$id, ...safeObject(target) });
            }
          }

          await append(omitSensitiveFields(user));
        }
      }
    }),
    await writer.writeNdjson("auth/teams.ndjson", safeTeams),
    await writer.writeNdjson("auth/memberships.ndjson", memberships.map((membership) => omitSensitiveFields(membership))),
    await writer.writeNdjson("auth/targets.ndjson", targets.map((target) => omitSensitiveFields(target))),
    await writer.writeJson("auth/meta.json", {
      exportedAt: new Date().toISOString(),
      counts: {
        users: userCount,
        teams: teams.total,
        memberships: memberships.length,
        targets: targets.length,
      },
      warnings,
    }),
  ];

  return {
    module: "auth",
    status: "complete",
    counts: {
      users: userCount,
      teams: teams.total,
      memberships: memberships.length,
    },
    warnings,
    files,
  };
}

function safeObject(value: unknown): JsonObject {
  return isObject(value) ? value : {};
}
