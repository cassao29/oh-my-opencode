const PRIVATE_PATTERN = /<private>[\s\S]*?<\/private>/g;

const SENSITIVE_PATTERNS = [
  /\.env$/,
  /\.env\..+$/,
  /secrets?\//i,
  /\.pem$/,
  /\.key$/,
  /\.crt$/,
  /\.p12$/,
  /\.pfx$/,
  /\.jks$/,
  /credentials/i,
  /password/i,
  /api[_-]?key/i,
  /secret[_-]?key/i,
  /private[_-]?key/i,
  /auth/i,
  /token/i,
  /\.log$/,
  /\.sqlite$/,
  /\.db$/,
  /\.sqlite3$/,
  /wallet/i,
  /keystore/i,
];

export function sanitizeContent(content: string): string {
  return content.replace(PRIVATE_PATTERN, "[REDACTED]");
}

export function isSensitivePath(path: string): boolean {
  return SENSITIVE_PATTERNS.some(pattern => pattern.test(path));
}

export function redactSecrets(content: string): string {
  if (!content || typeof content !== 'string') return content;

  const patterns = [
    /(?:password|pwd|pass|passwd)\s*[:=]\s*["']?[^\s"']+["']?/gi,
    /(?:api[_-]?key|apikey|access[_-]?key)\s*[:=]\s*["']?[^\s"']+["']?/gi,
    /(?:secret[_-]?key|private[_-]?key)\s*[:=]\s*["']?[^\s"']+["']?/gi,
    /(?:auth[_-]?token|bearer[_-]?token)\s*[:=]\s*["']?[^\s"']+["']?/gi,
    /(?:Bearer|Basic|Token)\s+[A-Za-z0-9+/=._-]+/gi,
    /(?:db[_-]?password|database[_-]?password)\s*[:=]\s*["']?[^\s"']+["']?/gi,
    /(?:connection[_-]?string|conn[_-]?str)\s*[:=]\s*["']?[^\s"']+["']?/gi,
    /(?:email|mail)\s*[:=]\s*["']?[^\s@]+@[^\s"']+["']?/gi,
    /(?:phone|mobile|tel)\s*[:=]\s*["']?[\d\s\-\(\)\+]+["']?/gi,
    /\b[A-Za-z0-9+/=]{32,}\b/g,
    /(?:https?|ftp|postgresql|postgres|mysql|mongodb|redis|amqp):\/\/[^\s"']*:[^\s"']*@[^\s"']*/gi,
    /-----BEGIN\s+(?:RSA\s+)?PRIVATE\s+KEY-----[\s\S]*?-----END\s+(?:RSA\s+)?PRIVATE\s+KEY-----/gi,
    /\bssh-(?:rsa|dss|ed25519)\s+[A-Za-z0-9+/=]+/gi,
  ];

  let result = content;
  for (const pattern of patterns) {
    result = result.replace(pattern, "[REDACTED]");
  }
  return result;
}
