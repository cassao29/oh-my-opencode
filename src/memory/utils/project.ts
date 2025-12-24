import { existsSync, mkdirSync, statSync } from "fs";
import { join, resolve } from "path";

export function getProjectPath(cwd?: string): string {
  const path = resolve(cwd ?? process.cwd());

  if (path.includes("..") || path.includes("../") || path.includes("..\\")) {
    throw new Error("Invalid project path: directory traversal detected");
  }

  const canonicalPath = resolve(path);
  if (canonicalPath !== path) {
    throw new Error("Invalid project path: not canonical");
  }

  const blockedExactPaths = ['/etc', '/usr', '/var', '/root', '/boot', '/sys', '/proc', '/home'];
  const blockedPrefixes = [
    '/etc/', '/usr/', '/var/', '/root/', '/boot/', '/sys/', '/proc/',
    'C:\\Windows', 'C:\\Program Files'
  ];

  if (blockedExactPaths.includes(path) || blockedExactPaths.includes(path.toLowerCase())) {
    throw new Error("Invalid project path: access to system directories not allowed");
  }

  for (const prefix of blockedPrefixes) {
    if (path.startsWith(prefix) || path.toLowerCase().startsWith(prefix.toLowerCase())) {
      throw new Error("Invalid project path: access to system directories not allowed");
    }
  }

  if (path.length > 4096) {
    throw new Error("Invalid project path: path too long");
  }

  return path;
}

export function getMemoryDbPath(projectPath?: string): string {
  const basePath = getProjectPath(projectPath);
  return join(basePath, ".opencode", "memory-pro", "memory.db");
}

export function ensureMemoryDir(projectPath?: string): string {
  const basePath = getProjectPath(projectPath);
  const memoryDir = join(basePath, ".opencode", "memory-pro");

  if (!existsSync(memoryDir)) {
    mkdirSync(memoryDir, { recursive: true, mode: 0o755 });
  }

  try {
    const stats = statSync(memoryDir);
    if (!stats.isDirectory()) {
      throw new Error("Memory directory is not a directory");
    }
  } catch (err) {
    throw new Error(`Cannot access memory directory: ${err instanceof Error ? err.message : 'Unknown error'}`);
  }

  return memoryDir;
}

export function isGitRepo(dir: string): boolean {
  return existsSync(join(dir, ".git"));
}

export function getProjectName(projectPath: string): string {
  const parts = projectPath.split("/");
  return parts[parts.length - 1] || projectPath;
}
