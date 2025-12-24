import type { Memory, MemoryType } from "../types";
import type { MemoryRelation, RelationType } from "./types";
import { randomUUID } from "crypto";

const RELATION_INDICATORS: Record<RelationType, RegExp[]> = {
  depends_on: [
    /depends?\s+on/i,
    /requires?\s/i,
    /needs?\s/i,
    /prerequisite/i,
    /based\s+on/i,
  ],
  supersedes: [
    /supersedes?/i,
    /replaces?/i,
    /instead\s+of/i,
    /no\s+longer\s+using/i,
    /migrated?\s+from/i,
    /switched\s+from/i,
  ],
  related_to: [
    /related\s+to/i,
    /similar\s+to/i,
    /see\s+also/i,
    /connects?\s+to/i,
  ],
  derived_from: [
    /derived\s+from/i,
    /extracted\s+from/i,
    /learned\s+from/i,
    /inspired\s+by/i,
  ],
  contradicts: [
    /contradicts?/i,
    /conflicts?\s+with/i,
    /incompatible\s+with/i,
    /versus/i,
    /vs\.?\s/i,
  ],
  supports: [
    /supports?/i,
    /reinforces?/i,
    /validates?/i,
    /confirms?/i,
    /aligns?\s+with/i,
  ],
  implements: [
    /implements?/i,
    /applies?\s/i,
    /follows?\s/i,
    /uses?\s+pattern/i,
  ],
  blocks: [
    /blocks?/i,
    /prevents?/i,
    /blocking/i,
    /blocked\s+by/i,
  ],
  resolves: [
    /resolves?/i,
    /fixes?/i,
    /solved?\s/i,
    /addressed/i,
    /workaround/i,
  ],
};

const TYPE_BASED_RELATIONS: Record<MemoryType, Record<MemoryType, RelationType[]>> = {
  decision: {
    decision: ["supersedes", "related_to", "contradicts", "supports"],
    learning: ["derived_from", "supports"],
    preference: ["supports", "contradicts"],
    blocker: ["resolves"],
    context: ["depends_on"],
    pattern: ["implements"],
  },
  learning: {
    decision: ["supports", "contradicts"],
    learning: ["related_to", "supports", "contradicts"],
    preference: [],
    blocker: ["resolves"],
    context: ["derived_from"],
    pattern: ["derived_from"],
  },
  preference: {
    decision: ["supports"],
    learning: [],
    preference: ["supersedes", "related_to"],
    blocker: [],
    context: [],
    pattern: ["supports"],
  },
  blocker: {
    decision: ["blocks"],
    learning: [],
    preference: [],
    blocker: ["related_to"],
    context: ["depends_on"],
    pattern: [],
  },
  context: {
    decision: [],
    learning: [],
    preference: [],
    blocker: [],
    context: ["related_to", "supersedes"],
    pattern: [],
  },
  pattern: {
    decision: [],
    learning: ["supports"],
    preference: [],
    blocker: [],
    context: [],
    pattern: ["related_to", "supersedes", "derived_from"],
  },
};

function detectRelationType(sourceContent: string, targetContent: string): RelationType | null {
  const combinedText = `${sourceContent} ${targetContent}`;
  
  for (const [relationType, patterns] of Object.entries(RELATION_INDICATORS)) {
    for (const pattern of patterns) {
      if (pattern.test(combinedText)) {
        return relationType as RelationType;
      }
    }
  }
  
  return null;
}

function calculateSimilarity(text1: string, text2: string): number {
  const words1 = new Set(text1.toLowerCase().split(/\s+/).filter(w => w.length > 3));
  const words2 = new Set(text2.toLowerCase().split(/\s+/).filter(w => w.length > 3));
  
  if (words1.size === 0 || words2.size === 0) return 0;
  
  const intersection = new Set([...words1].filter(w => words2.has(w)));
  const union = new Set([...words1, ...words2]);
  
  return intersection.size / union.size;
}

export function extractRelations(
  memories: Memory[],
  similarityThreshold = 0.3
): MemoryRelation[] {
  const relations: MemoryRelation[] = [];
  const existingRelations = new Set<string>();

  for (let i = 0; i < memories.length; i++) {
    const source = memories[i];
    
    for (let j = i + 1; j < memories.length; j++) {
      const target = memories[j];
      
      if (source.scope !== target.scope) continue;
      
      const similarity = calculateSimilarity(source.content, target.content);
      if (similarity < similarityThreshold) continue;

      const detectedType = detectRelationType(source.content, target.content);
      
      const possibleTypes = TYPE_BASED_RELATIONS[source.type]?.[target.type] || [];
      const relationType = detectedType && possibleTypes.includes(detectedType)
        ? detectedType
        : possibleTypes[0] || "related_to";

      const relationKey = `${source.id}:${target.id}:${relationType}`;
      if (existingRelations.has(relationKey)) continue;

      relations.push({
        id: randomUUID(),
        source_id: source.id,
        target_id: target.id,
        relation_type: relationType,
        metadata: {
          similarity_score: similarity,
          auto_detected: !!detectedType,
        },
        created_at: new Date().toISOString(),
      });

      existingRelations.add(relationKey);
    }
  }

  return relations;
}

export function findRelatedMemories(
  memory: Memory,
  allMemories: Memory[],
  maxResults = 5
): Array<{ memory: Memory; relation: RelationType; score: number }> {
  const results: Array<{ memory: Memory; relation: RelationType; score: number }> = [];

  for (const other of allMemories) {
    if (other.id === memory.id) continue;
    
    const similarity = calculateSimilarity(memory.content, other.content);
    if (similarity < 0.2) continue;

    const detectedType = detectRelationType(memory.content, other.content);
    const possibleTypes = TYPE_BASED_RELATIONS[memory.type]?.[other.type] || [];
    const relationType = detectedType && possibleTypes.includes(detectedType)
      ? detectedType
      : possibleTypes[0] || "related_to";

    let score = similarity;
    if (memory.scope === other.scope) score += 0.2;
    if (detectedType) score += 0.1;

    results.push({
      memory: other,
      relation: relationType,
      score: Math.min(1, score),
    });
  }

  return results
    .sort((a, b) => b.score - a.score)
    .slice(0, maxResults);
}
