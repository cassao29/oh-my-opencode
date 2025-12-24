export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export function countTokens(text: string): number {
  return estimateTokens(text);
}

export function truncateToTokens(text: string, maxTokens: number): string {
  const maxChars = maxTokens * 4;
  if (text.length <= maxChars) return text;
  
  return text.slice(0, maxChars - 20) + "\n...[truncated]";
}

export function isWithinTokenLimit(text: string, limit: number): boolean {
  return estimateTokens(text) <= limit;
}
