import { getStorage } from "../../memory/storage/sqlite";
import { getMemoryDbPath } from "../../memory/utils/project";
import { secureLog } from "../../memory/utils/logging";
import { getSyncService } from "../../memory/sync/sync-service";

export async function handleSessionEnd(
  projectPath: string,
  sessionId: string
): Promise<void> {
  try {
    const dbPath = getMemoryDbPath(projectPath);
    const storage = getStorage(dbPath);

    const observations = storage.getSessionObservations(sessionId);

    let summary: string | undefined;

    if (observations.length > 0) {
      const toolCounts = new Map<string, number>();
      observations.forEach(obs => {
        const count = toolCounts.get(obs.tool_name) || 0;
        toolCounts.set(obs.tool_name, count + 1);
      });

      const toolSummary = Array.from(toolCounts.entries())
        .map(([tool, count]) => `${tool}: ${count}`)
        .join(", ");

      summary = `Session activity: ${observations.length} tool executions (${toolSummary})`;
    }

    storage.endSession(sessionId, summary);

    const syncService = getSyncService(projectPath);
    const syncResult = await syncService.sync();
    
    if (syncResult.errors.length > 0) {
      secureLog('warn', 'Memory sync completed with errors', { errors: syncResult.errors });
    } else if (syncResult.created > 0) {
      secureLog('info', 'Memory sync completed', { 
        created: syncResult.created, 
        updated: syncResult.updated 
      });
    }
  } catch (err) {
    secureLog('warn', 'Failed to end session', { error: err instanceof Error ? err.message : 'Unknown' });
  }
}
