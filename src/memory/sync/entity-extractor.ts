import type { Memory } from "../types";
import type { Entity, EntityType, MemoryEntity } from "./types";
import { randomUUID } from "crypto";

const TECHNOLOGY_PATTERNS = [
  /\b(React|Vue|Angular|Svelte|Next\.?js|Nuxt|Remix)\b/gi,
  /\b(Node\.?js|Deno|Bun|Express|Fastify|Hono)\b/gi,
  /\b(TypeScript|JavaScript|Python|Rust|Go|Java|C\+\+|Ruby)\b/gi,
  /\b(PostgreSQL|MySQL|MongoDB|Redis|SQLite|Neo4j|DynamoDB)\b/gi,
  /\b(Docker|Kubernetes|AWS|GCP|Azure|Vercel|Railway)\b/gi,
  /\b(GraphQL|REST|gRPC|WebSocket|HTTP)\b/gi,
  /\b(Jest|Vitest|Mocha|Pytest|Bun test)\b/gi,
  /\b(Zod|Yup|Joi|ajv)\b/gi,
];

const CONCEPT_PATTERNS = [
  /\b(authentication|authorization|auth)\b/gi,
  /\b(caching|memoization|cache)\b/gi,
  /\b(API|endpoint|route|handler)\b/gi,
  /\b(database|schema|migration|query)\b/gi,
  /\b(testing|unit test|integration test|e2e)\b/gi,
  /\b(security|encryption|hashing|token)\b/gi,
  /\b(performance|optimization|latency)\b/gi,
  /\b(error handling|exception|fallback)\b/gi,
  /\b(logging|monitoring|observability)\b/gi,
  /\b(deployment|CI\/CD|pipeline)\b/gi,
];

const FILE_PATTERN = /(?:^|[\s`'"(])([a-zA-Z0-9_\-./]+\.(ts|tsx|js|jsx|py|rs|go|java|rb|md|json|yaml|yml|sql|graphql))\b/g;

const PROJECT_PATTERN = /\b(?:project|repo|repository|package)[\s:]+["']?([a-zA-Z0-9_\-]+)["']?/gi;

function normalizeEntityName(name: string): string {
  return name.toLowerCase().trim().replace(/\s+/g, "-");
}

function createEntity(name: string, type: EntityType, existingEntities: Map<string, Entity>): Entity {
  const normalizedName = normalizeEntityName(name);
  const key = `${type}:${normalizedName}`;
  
  if (existingEntities.has(key)) {
    const existing = existingEntities.get(key)!;
    existing.mention_count++;
    return existing;
  }

  const entity: Entity = {
    id: randomUUID(),
    name: normalizedName,
    entity_type: type,
    first_seen: new Date().toISOString(),
    mention_count: 1,
  };

  existingEntities.set(key, entity);
  return entity;
}

export function extractEntities(
  memory: Memory,
  existingEntities: Map<string, Entity> = new Map()
): { entities: Entity[]; relations: MemoryEntity[] } {
  const content = memory.content;
  const scope = memory.scope;
  const foundEntities: Entity[] = [];
  const memoryEntities: MemoryEntity[] = [];

  const scopeParts = scope.split("/");
  if (scopeParts.length > 0 && scopeParts[0]) {
    const projectEntity = createEntity(scopeParts[0], "project", existingEntities);
    foundEntities.push(projectEntity);
    memoryEntities.push({
      memory_id: memory.id,
      entity_id: projectEntity.id,
      relevance_score: 1.0,
    });
  }

  if (scopeParts.length > 1 && scopeParts[1]) {
    const componentEntity = createEntity(scopeParts[1], "component", existingEntities);
    foundEntities.push(componentEntity);
    memoryEntities.push({
      memory_id: memory.id,
      entity_id: componentEntity.id,
      relevance_score: 0.9,
    });
  }

  for (const pattern of TECHNOLOGY_PATTERNS) {
    const matches = content.matchAll(pattern);
    for (const match of matches) {
      const techEntity = createEntity(match[1], "technology", existingEntities);
      if (!foundEntities.find(e => e.id === techEntity.id)) {
        foundEntities.push(techEntity);
        memoryEntities.push({
          memory_id: memory.id,
          entity_id: techEntity.id,
          relevance_score: 0.8,
        });
      }
    }
  }

  for (const pattern of CONCEPT_PATTERNS) {
    const matches = content.matchAll(pattern);
    for (const match of matches) {
      const conceptEntity = createEntity(match[1], "concept", existingEntities);
      if (!foundEntities.find(e => e.id === conceptEntity.id)) {
        foundEntities.push(conceptEntity);
        memoryEntities.push({
          memory_id: memory.id,
          entity_id: conceptEntity.id,
          relevance_score: 0.6,
        });
      }
    }
  }

  const fileMatches = content.matchAll(FILE_PATTERN);
  for (const match of fileMatches) {
    const fileEntity = createEntity(match[1], "file", existingEntities);
    if (!foundEntities.find(e => e.id === fileEntity.id)) {
      foundEntities.push(fileEntity);
      memoryEntities.push({
        memory_id: memory.id,
        entity_id: fileEntity.id,
        relevance_score: 0.7,
      });
    }
  }

  return { entities: foundEntities, relations: memoryEntities };
}

export function extractEntitiesFromBatch(
  memories: Memory[]
): { entities: Entity[]; relations: MemoryEntity[] } {
  const entityMap = new Map<string, Entity>();
  const allRelations: MemoryEntity[] = [];

  for (const memory of memories) {
    const { entities, relations } = extractEntities(memory, entityMap);
    allRelations.push(...relations);
  }

  return {
    entities: Array.from(entityMap.values()),
    relations: allRelations,
  };
}
