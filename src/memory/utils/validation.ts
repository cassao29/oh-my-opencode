import { resolve } from "path";

export function validateSessionId(sessionId: string | undefined): boolean {
  if (!sessionId || typeof sessionId !== 'string') return false;
  if (sessionId.length > 36) return false;

  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
  return uuidRegex.test(sessionId);
}

export function validateProjectPath(path: string): boolean {
  if (!path || typeof path !== 'string') return false;
  if (path.length > 4096) return false;

  const resolved = resolve(path);
  return resolved === path && !path.includes('..') && !path.includes('../') && !path.includes('..\\');
}
