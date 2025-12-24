/**
 * LITM (Lost in the Middle) Reordering - Liu et al., TACL 2024 (arXiv:2307.03172)
 * LLMs have 40-60% accuracy loss for mid-context info. Pattern: [1st,3rd,5th,...,6th,4th,2nd]
 */

export function litmReorder<T>(items: T[]): T[] {
  if (items.length <= 2) return items;

  const reversed = [...items].reverse();
  const reordered: T[] = [];

  for (let i = 0; i < reversed.length; i++) {
    if (i % 2 === 0) {
      reordered.push(reversed[i]);
    } else {
      reordered.unshift(reversed[i]);
    }
  }

  return reordered;
}

export function litmReorderWithPositions<T>(
  items: T[]
): Array<{ item: T; originalIndex: number; newPosition: "start" | "middle" | "end" }> {
  if (items.length === 0) return [];

  const reordered = litmReorder(items);
  const totalLength = reordered.length;

  return reordered.map((item, newIndex) => {
    const originalIndex = items.indexOf(item);
    let newPosition: "start" | "middle" | "end";

    if (newIndex === 0) {
      newPosition = "start";
    } else if (newIndex === totalLength - 1) {
      newPosition = "end";
    } else {
      newPosition = "middle";
    }

    return { item, originalIndex, newPosition };
  });
}

export function litmReorderText(content: string, separator: string = "\n\n"): string {
  const chunks = content.split(separator).filter((c) => c.trim().length > 0);
  if (chunks.length <= 2) return content;
  return litmReorder(chunks).join(separator);
}

export function buildLitmAwareContext(
  critical: string[],
  important: string[],
  background: string[]
): string {
  const sections: string[] = [];

  if (critical.length > 0) {
    sections.push("## CRITICAL CONSTRAINTS\n" + critical.join("\n"));
  }

  if (important.length > 0) {
    const reorderedImportant = litmReorder(important);
    sections.push("## IMPORTANT CONTEXT\n" + reorderedImportant.join("\n"));
  }

  if (background.length > 0) {
    sections.push("## BACKGROUND\n" + background.join("\n"));
  }

  if (critical.length > 0) {
    sections.push("## REMINDER\n" + critical.join("\n"));
  }

  return sections.join("\n\n");
}

export function litmReorderByScore<T>(items: T[], getScore: (item: T) => number): T[] {
  const sorted = [...items].sort((a, b) => getScore(b) - getScore(a));
  return litmReorder(sorted);
}

export type LitmPosition = "start" | "middle" | "end";

export interface LitmConfig {
  enabled: boolean;
  minItems: number;
  repeatCritical: boolean;
}

export const DEFAULT_LITM_CONFIG: LitmConfig = {
  enabled: true,
  minItems: 3,
  repeatCritical: false,
};

export function applyLitm<T>(items: T[], config: Partial<LitmConfig> = {}): T[] {
  const cfg = { ...DEFAULT_LITM_CONFIG, ...config };
  if (!cfg.enabled || items.length < cfg.minItems) return items;
  return litmReorder(items);
}
