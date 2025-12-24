interface LogEntry {
  timestamp: string;
  level: string;
  message: string;
  meta?: string;
}

export function secureLog(level: 'info' | 'warn' | 'error', message: string, meta?: unknown): void {
  const sanitizedMessage = message
    .replace(/\/[^\s]+/g, '[PATH REDACTED]')
    .replace(/[a-f0-9]{32,}/gi, '[HASH REDACTED]')
    .replace(/\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/g, '[IP REDACTED]')
    .replace(/[^\s@]+@[^\s@]+\.[^\s@]+/g, '[EMAIL REDACTED]');

  const logEntry: LogEntry = {
    timestamp: new Date().toISOString(),
    level,
    message: sanitizedMessage,
  };

  if (meta) {
    logEntry.meta = JSON.stringify(meta).replace(/password|token|key/gi, '[REDACTED]');
  }

  switch (level) {
    case 'error':
      console.error(JSON.stringify(logEntry));
      break;
    case 'warn':
      console.warn(JSON.stringify(logEntry));
      break;
    default:
      console.log(JSON.stringify(logEntry));
  }
}
