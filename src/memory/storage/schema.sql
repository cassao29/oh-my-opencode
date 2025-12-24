-- OpenCode Memory Pro - Database Schema
-- Version: 0.1.0

-- Sessoes de trabalho
CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    project_path TEXT NOT NULL,
    started_at TEXT NOT NULL DEFAULT (datetime('now')),
    ended_at TEXT,
    summary TEXT,
    tokens_used INTEGER DEFAULT 0
);

-- Observacoes (tool executions comprimidas)
CREATE TABLE IF NOT EXISTS observations (
    id TEXT PRIMARY KEY,
    session_id TEXT REFERENCES sessions(id) ON DELETE CASCADE,
    timestamp TEXT NOT NULL DEFAULT (datetime('now')),
    tool_name TEXT NOT NULL,
    tool_args TEXT,
    compressed_output TEXT,
    tokens INTEGER,
    type TEXT CHECK(type IN ('read', 'write', 'edit', 'bash', 'other')),
    relevance_score REAL DEFAULT 0.5
);

-- Memorias explicitas (decisions, learnings, etc)
CREATE TABLE IF NOT EXISTS memories (
    id TEXT PRIMARY KEY,
    session_id TEXT REFERENCES sessions(id) ON DELETE SET NULL,
    timestamp TEXT NOT NULL DEFAULT (datetime('now')),
    type TEXT NOT NULL CHECK(type IN ('decision', 'learning', 'preference', 'blocker', 'context', 'pattern')),
    scope TEXT NOT NULL,
    content TEXT NOT NULL,
    project_path TEXT,
    tags TEXT,
    source TEXT CHECK(source IN ('auto', 'manual', 'extracted')) DEFAULT 'manual',
    issue TEXT
);

-- Prompts do usuario
CREATE TABLE IF NOT EXISTS prompts (
    id TEXT PRIMARY KEY,
    session_id TEXT REFERENCES sessions(id) ON DELETE CASCADE,
    timestamp TEXT NOT NULL DEFAULT (datetime('now')),
    content TEXT NOT NULL,
    extracted_intent TEXT
);

-- Full-text search para memorias
CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts USING fts5(
    content,
    scope,
    tags,
    content=memories,
    content_rowid=rowid
);

-- Triggers para manter FTS sincronizado
CREATE TRIGGER IF NOT EXISTS memories_ai AFTER INSERT ON memories BEGIN
    INSERT INTO memories_fts(rowid, content, scope, tags)
    VALUES (NEW.rowid, NEW.content, NEW.scope, NEW.tags);
END;

CREATE TRIGGER IF NOT EXISTS memories_ad AFTER DELETE ON memories BEGIN
    INSERT INTO memories_fts(memories_fts, rowid, content, scope, tags)
    VALUES ('delete', OLD.rowid, OLD.content, OLD.scope, OLD.tags);
END;

CREATE TRIGGER IF NOT EXISTS memories_au AFTER UPDATE ON memories BEGIN
    INSERT INTO memories_fts(memories_fts, rowid, content, scope, tags)
    VALUES ('delete', OLD.rowid, OLD.content, OLD.scope, OLD.tags);
    INSERT INTO memories_fts(rowid, content, scope, tags)
    VALUES (NEW.rowid, NEW.content, NEW.scope, NEW.tags);
END;

-- Full-text search para observations
CREATE VIRTUAL TABLE IF NOT EXISTS observations_fts USING fts5(
    compressed_output,
    tool_name,
    content=observations,
    content_rowid=rowid
);

-- Triggers para observations FTS
CREATE TRIGGER IF NOT EXISTS observations_ai AFTER INSERT ON observations BEGIN
    INSERT INTO observations_fts(rowid, compressed_output, tool_name)
    VALUES (NEW.rowid, NEW.compressed_output, NEW.tool_name);
END;

CREATE TRIGGER IF NOT EXISTS observations_ad AFTER DELETE ON observations BEGIN
    INSERT INTO observations_fts(observations_fts, rowid, compressed_output, tool_name)
    VALUES ('delete', OLD.rowid, OLD.compressed_output, OLD.tool_name);
END;

CREATE TRIGGER IF NOT EXISTS observations_au AFTER UPDATE ON observations BEGIN
    INSERT INTO observations_fts(observations_fts, rowid, compressed_output, tool_name)
    VALUES ('delete', OLD.rowid, OLD.compressed_output, OLD.tool_name);
    INSERT INTO observations_fts(rowid, compressed_output, tool_name)
    VALUES (NEW.rowid, NEW.compressed_output, NEW.tool_name);
END;

-- Indices para performance
CREATE INDEX IF NOT EXISTS idx_memories_project ON memories(project_path);
CREATE INDEX IF NOT EXISTS idx_memories_type ON memories(type);
CREATE INDEX IF NOT EXISTS idx_memories_scope ON memories(scope);
CREATE INDEX IF NOT EXISTS idx_memories_timestamp ON memories(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_observations_session ON observations(session_id);
CREATE INDEX IF NOT EXISTS idx_observations_type ON observations(type);
CREATE INDEX IF NOT EXISTS idx_sessions_project ON sessions(project_path);
CREATE INDEX IF NOT EXISTS idx_sessions_started ON sessions(started_at DESC);
