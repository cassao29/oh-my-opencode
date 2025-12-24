import type { ObservationMaskingConfig } from "./types";

export const DEFAULT_OBSERVATION_MASKING_CONFIG: ObservationMaskingConfig = {
  enabled: true,
  maxAge: 10,
  preserveRecent: 3,
  preserveTools: ["Read", "read", "Edit", "edit", "Write", "write"],
  maskPlaceholder: "[Output masked - {tool} executed {age} actions ago]",
};

export const MASKABLE_TOOLS = [
  "grep",
  "Grep",
  "safe_grep",
  "glob",
  "Glob",
  "safe_glob",
  "Bash",
  "bash",
  "interactive_bash",
  "lsp_find_references",
  "lsp_document_symbols",
  "lsp_workspace_symbols",
  "lsp_diagnostics",
  "lsp_hover",
  "ast_grep_search",
  "websearch_exa_web_search_exa",
  "context7_get-library-docs",
  "grep_app_searchGitHub",
];
