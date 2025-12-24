import { tool } from "@opencode-ai/plugin";
import { getStorage } from "../../memory/storage/sqlite";

export const memory_list = tool({
  description: "List all unique scopes and types in memory for discovery",
  args: {},
  async execute() {
    try {
      const storage = getStorage();
      
      const scopes = storage.listScopes();
      const types = storage.listTypes();
      const stats = storage.getStats();

      const scopesList = scopes.length > 0 
        ? scopes.map(s => `  - ${s}`).join("\n")
        : "  (none)";
      
      const typesList = types.length > 0
        ? types.map(t => `  - ${t}`).join("\n")
        : "  (none)";

      return `Memory Statistics:
- Total memories: ${stats.memories}
- Total sessions: ${stats.sessions}
- Total observations: ${stats.observations}

Scopes:
${scopesList}

Types:
${typesList}`;
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      return `Failed to list memories: ${msg}`;
    }
  },
});
