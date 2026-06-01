import type { AppwriteServices } from "../appwrite/client";
import type { AppwriteConfig } from "../appwrite/config";
import { downloadFunctionDeployment } from "../appwrite/http-download";
import type { BackupWriter } from "../backup/backup-writer";
import { listAll } from "../utils/pagination";
import { omitSensitiveFields } from "./sanitize";
import type { JsonObject, ModuleExportResult } from "./types";

export async function exportFunctions(config: AppwriteConfig, services: AppwriteServices, writer: BackupWriter): Promise<ModuleExportResult> {
  await writer.ensureDir("functions");

  const functions = await listAll("functions", (queries) => services.functions.list(queries));
  const files: string[] = [];
  const exportedFunctions = [];
  const warnings = [
    "Function variable values can be hidden by Appwrite and are exported as placeholders when unavailable.",
    "Function deployments may be unavailable depending on Appwrite permissions and deployment storage state.",
  ];
  let variableCount = 0;
  let deploymentCount = 0;
  let downloadedDeployments = 0;
  let discoveredDeploymentCount = 0;

  for (const fn of functions.rows) {
    const functionId = String(fn.$id);
    await writer.ensureDir(`functions/function_${functionId}`);

    const variables = await services.functions.listVariables(functionId);
    const deployments = await listAll("deployments", (queries) => services.functions.listDeployments(functionId, queries));
    variableCount += variables.total;
    deploymentCount += deployments.total;

    const variablePlaceholders = variables.variables.map((variable) => createVariableExport(variable));

    const deploymentExports: JsonObject[] = [];
    const deploymentIds = new Set<string>();

    for (const deployment of deployments.rows) {
      deploymentIds.add(String(deployment.$id));
    }

    for (const key of ["deploymentId", "latestDeploymentId"]) {
      const id = toObject(fn)[key];
      if (typeof id === "string" && id.length > 0) {
        deploymentIds.add(id);
      }
    }

    for (const deploymentId of deploymentIds) {
      discoveredDeploymentCount += 1;
      const deploymentMeta: JsonObject = { deploymentId, sourcePath: null, sourceSha256: null, downloadError: null };

      try {
        const deployment = await services.functions.getDeployment(functionId, deploymentId);
        deploymentMeta.deployment = deployment;
      } catch (error) {
        deploymentMeta.getDeploymentError = error instanceof Error ? error.message : "Unknown deployment metadata error";
      }

      try {
        const sourcePath = `functions/function_${functionId}/deployment_${deploymentId}.tar.gz`;
        const download = await downloadFunctionDeployment({
          config,
          functionId,
          deploymentId,
          type: "source",
          outputPath: writer.resolvePath(sourcePath),
        });
        deploymentMeta.sourcePath = sourcePath;
        deploymentMeta.sourceSha256 = download.sha256;
        deploymentMeta.sourceBytes = download.bytes;
        downloadedDeployments += 1;
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown deployment download error";
        deploymentMeta.downloadError = message;
        warnings.push(`Failed to download function deployment ${functionId}/${deploymentId}: ${message}`);
      }

      deploymentExports.push(deploymentMeta);
    }

    const functionExport = {
      function: omitSensitiveFields(fn),
      variables: variablePlaceholders,
      deployments: deploymentExports,
      exportStatus: {
        hasVariables: variables.total > 0,
        deploymentsDiscovered: deploymentIds.size,
        deploymentsDownloaded: deploymentExports.filter((deployment) => deployment.sourcePath !== null).length,
        requiresManualVariables: variablePlaceholders.some((variable) => variable.requiresManualInput),
      },
    };

    exportedFunctions.push(functionExport);

    files.push(await writer.writeJson(`functions/function_${functionId}/meta.json`, functionExport));
    files.push(await writer.writeJson(`functions/function_${functionId}/variables.json`, functionExport.variables));
    files.push(await writer.writeJson(`functions/function_${functionId}/variables.placeholders.json`, { variables: variablePlaceholders }));
    files.push(await writer.writeJson(`functions/function_${functionId}/export-status.json`, functionExport.exportStatus));
  }

  files.push(await writer.writeJson("functions/functions.json", exportedFunctions));
  files.push(
    await writer.writeJson("functions/meta.json", {
      exportedAt: new Date().toISOString(),
      counts: {
        functions: functions.total,
        variables: variableCount,
        deployments: deploymentCount,
        discoveredDeployments: discoveredDeploymentCount,
        downloadedDeployments,
      },
      warnings,
    }),
  );

  return {
    module: "functions",
    status: downloadedDeployments < discoveredDeploymentCount ? "partial" : "complete",
    counts: {
      functions: functions.total,
    },
    warnings,
    files,
  };
}

function toObject(value: unknown): JsonObject {
  return typeof value === "object" && value !== null ? (value as JsonObject) : {};
}

function createVariableExport(variable: { $id: string; key: string; value: unknown; secret: boolean }): JsonObject {
  return {
    variableId: variable.$id,
    key: variable.key,
    valueRestorable: false,
    requiresManualInput: true,
    secret: variable.secret,
    valuePreview: typeof variable.value === "string" ? `[${variable.value.length} chars redacted]` : null,
  };
}
