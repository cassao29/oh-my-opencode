/**
 * Memory Module for Oh-My-OpenCode
 *
 * This memory system is based on opencode-memory-pro, which evolved from
 * opencode-memory-simple. It provides persistent memory capabilities with:
 * - SQLite storage with FTS5 full-text search
 * - Neo4j sync for graph-based queries (optional)
 * - Enterprise security (path traversal protection, secret redaction)
 * - 12 memory tools for comprehensive memory management
 *
 * Development path:
 *   opencode-memory-simple → opencode-memory-pro → oh-my-opencode (integrated)
 *
 * @author Cassao + Sisyphus
 * @since 2025-12-24
 */

export * from "./storage";
export * from "./utils";
export * from "./types";
export * from "./sync";
