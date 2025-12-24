import { tool } from "@opencode-ai/plugin";
import { getStorage } from "../../memory/storage/sqlite";
import { tryConnectNeo4j } from "../../memory/sync/neo4j-client";
import { findRelatedMemories } from "../../memory/sync/relation-extractor";
import type { Memory, MemoryType } from "../../memory/types";
import type { RelationType } from "../../memory/sync/types";

type OutputFormat = "ascii" | "mermaid" | "dot" | "json";

interface GraphData {
  nodes: Array<{
    id: string;
    type: MemoryType;
    scope: string;
    label: string;
    content_preview: string;
  }>;
  edges: Array<{
    source: string;
    target: string;
    relation: string;
    weight?: number;
  }>;
}

const TYPE_COLORS: Record<MemoryType, string> = {
  decision: "🟢",
  learning: "🔵",
  preference: "🟣",
  blocker: "🔴",
  context: "🟡",
  pattern: "🟠",
};

const TYPE_SHAPES: Record<MemoryType, string> = {
  decision: "hexagon",
  learning: "rect",
  preference: "stadium",
  blocker: "trapezoid",
  context: "cylinder",
  pattern: "parallelogram",
};

const RELATION_ARROWS: Record<RelationType | string, string> = {
  depends_on: "-->",
  supersedes: "==>",
  related_to: "<-->",
  derived_from: "-.->",
  contradicts: "--x",
  supports: "-->",
  implements: "-->",
  blocks: "--x",
  resolves: "-->",
  related: "---",
};

function truncate(str: string, maxLen: number): string {
  if (str.length <= maxLen) return str;
  return str.substring(0, maxLen - 3) + "...";
}

function sanitizeForMermaid(str: string): string {
  return str
    .replace(/"/g, "'")
    .replace(/\n/g, " ")
    .replace(/[[\]{}()#&]/g, " ")
    .trim();
}

function sanitizeForDot(str: string): string {
  return str
    .replace(/"/g, '\\"')
    .replace(/\n/g, "\\n")
    .trim();
}

function buildGraphData(
  memories: Memory[],
  relations: Array<{ source: Memory; target: Memory; relation: string; score?: number }>
): GraphData {
  const nodes = memories.map(m => ({
    id: m.id,
    type: m.type,
    scope: m.scope,
    label: `${m.type}:${m.scope}`,
    content_preview: truncate(m.content, 80),
  }));

  const edges = relations.map(r => ({
    source: r.source.id,
    target: r.target.id,
    relation: r.relation,
    weight: r.score,
  }));

  return { nodes, edges };
}

function renderAsciiLegend(): string[] {
  const lines: string[] = ["  LEGEND:", "  ────────"];
  for (const [type, emoji] of Object.entries(TYPE_COLORS)) {
    lines.push(`    ${emoji} ${type}`);
  }
  return lines;
}

function renderAsciiNodes(data: GraphData): string[] {
  const lines: string[] = [`  NODES (${data.nodes.length}):`, "  ─────────────"];
  for (const node of data.nodes) {
    const emoji = TYPE_COLORS[node.type] || "⚪";
    const shortId = node.id.substring(0, 8);
    lines.push(`    ${emoji} [${shortId}] ${node.scope}`);
    if (node.content_preview) {
      lines.push(`       └─ "${truncate(node.content_preview, 60)}"`);
    }
  }
  return lines;
}

function renderAsciiEdges(data: GraphData): string[] {
  if (data.edges.length === 0) {
    return ["  RELATIONSHIPS: None detected"];
  }
  
  const lines: string[] = [`  RELATIONSHIPS (${data.edges.length}):`, "  ─────────────────"];
  for (const edge of data.edges) {
    const sourceNode = data.nodes.find(n => n.id === edge.source);
    const targetNode = data.nodes.find(n => n.id === edge.target);
    const sourceLabel = sourceNode ? sourceNode.scope : edge.source.substring(0, 8);
    const targetLabel = targetNode ? targetNode.scope : edge.target.substring(0, 8);
    const weight = edge.weight ? ` (${Math.round(edge.weight * 100)}%)` : "";
    lines.push(`    ${sourceLabel} ──[${edge.relation}]──> ${targetLabel}${weight}`);
  }
  return lines;
}

function renderAscii(data: GraphData): string {
  const sections = [
    "╔════════════════════════════════════════════════════════════════════════╗",
    "║                        MEMORY GRAPH VISUALIZATION                       ║",
    "╠════════════════════════════════════════════════════════════════════════╣",
    "",
    ...renderAsciiLegend(),
    "",
    ...renderAsciiNodes(data),
    "",
    ...renderAsciiEdges(data),
    "",
    "╚════════════════════════════════════════════════════════════════════════╝",
  ];
  return sections.join("\n");
}

function groupNodesByType(nodes: GraphData["nodes"]): Map<MemoryType, GraphData["nodes"]> {
  const nodesByType = new Map<MemoryType, GraphData["nodes"]>();
  for (const node of nodes) {
    const existing = nodesByType.get(node.type) || [];
    existing.push(node);
    nodesByType.set(node.type, existing);
  }
  return nodesByType;
}

function getMermaidNodeShape(node: GraphData["nodes"][0], shape: string): string {
  const safeId = node.id.replace(/-/g, "_").substring(0, 16);
  const safeLabel = sanitizeForMermaid(truncate(node.scope + ": " + node.content_preview, 40));
  
  const shapeWrappers: Record<string, [string, string]> = {
    hexagon: ["{{", "}}"],
    stadium: ["([", "])"],
    trapezoid: ["[/", "\\]"],
    cylinder: ["[(", ")]"],
    parallelogram: ["[/", "/]"],
    rect: ["[", "]"],
  };
  
  const [open, close] = shapeWrappers[shape] || ["[", "]"];
  return `    ${safeId}${open}${safeLabel}${close}`;
}

function renderMermaidSubgraphs(nodesByType: Map<MemoryType, GraphData["nodes"]>): string[] {
  const lines: string[] = [];
  for (const [type, nodes] of nodesByType.entries()) {
    const shape = TYPE_SHAPES[type] || "rect";
    lines.push(`  subgraph ${type.toUpperCase()}`);
    lines.push(`    direction TB`);
    for (const node of nodes) {
      lines.push(getMermaidNodeShape(node, shape));
    }
    lines.push("  end");
    lines.push("");
  }
  return lines;
}

function renderMermaidEdges(edges: GraphData["edges"]): string[] {
  if (edges.length === 0) return [];
  
  const lines: string[] = [];
  for (const edge of edges) {
    const sourceId = edge.source.replace(/-/g, "_").substring(0, 16);
    const targetId = edge.target.replace(/-/g, "_").substring(0, 16);
    const arrow = RELATION_ARROWS[edge.relation] || "-->";
    lines.push(`  ${sourceId} ${arrow}|${edge.relation}| ${targetId}`);
  }
  return lines;
}

function renderMermaidStyles(): string[] {
  return [
    "",
    "  classDef decision fill:#22c55e,stroke:#15803d,color:#fff",
    "  classDef learning fill:#3b82f6,stroke:#1d4ed8,color:#fff",
    "  classDef preference fill:#a855f7,stroke:#7e22ce,color:#fff",
    "  classDef blocker fill:#ef4444,stroke:#b91c1c,color:#fff",
    "  classDef context fill:#eab308,stroke:#a16207,color:#000",
    "  classDef pattern fill:#f97316,stroke:#c2410c,color:#fff",
  ];
}

function renderMermaid(data: GraphData): string {
  const nodesByType = groupNodesByType(data.nodes);
  
  const lines = [
    "```mermaid",
    "graph TD",
    "",
    ...renderMermaidSubgraphs(nodesByType),
    ...renderMermaidEdges(data.edges),
    ...renderMermaidStyles(),
    "```",
  ];
  
  return lines.join("\n");
}

const DOT_COLORS: Record<MemoryType, string> = {
  decision: "#22c55e",
  learning: "#3b82f6",
  preference: "#a855f7",
  blocker: "#ef4444",
  context: "#eab308",
  pattern: "#f97316",
};

const DOT_SHAPES: Record<MemoryType, string> = {
  decision: "hexagon",
  learning: "box",
  preference: "ellipse",
  blocker: "octagon",
  context: "cylinder",
  pattern: "parallelogram",
};

function renderDotNodes(nodes: GraphData["nodes"]): string[] {
  return nodes.map(node => {
    const safeId = `"${node.id}"`;
    const label = sanitizeForDot(truncate(`${node.scope}\\n${node.content_preview}`, 60));
    const color = DOT_COLORS[node.type] || "#999999";
    const shape = DOT_SHAPES[node.type] || "box";
    return `  ${safeId} [label="${label}", shape=${shape}, style=filled, fillcolor="${color}", fontcolor=white];`;
  });
}

function renderDotEdges(edges: GraphData["edges"]): string[] {
  return edges.map(edge => {
    const sourceId = `"${edge.source}"`;
    const targetId = `"${edge.target}"`;
    const label = edge.relation;
    const style = edge.relation === "contradicts" || edge.relation === "blocks" ? "dashed" : "solid";
    return `  ${sourceId} -> ${targetId} [label="${label}", style=${style}];`;
  });
}

function renderDot(data: GraphData): string {
  const lines = [
    "digraph MemoryGraph {",
    "  rankdir=TB;",
    '  node [fontname="Helvetica", fontsize=10];',
    '  edge [fontname="Helvetica", fontsize=8];',
    "",
    ...renderDotNodes(data.nodes),
    "",
    ...renderDotEdges(data.edges),
    "}",
  ];
  
  return lines.join("\n");
}

function renderJson(data: GraphData): string {
  return JSON.stringify({
    format: "memory_graph",
    version: "1.0",
    generated_at: new Date().toISOString(),
    statistics: {
      node_count: data.nodes.length,
      edge_count: data.edges.length,
      types: [...new Set(data.nodes.map(n => n.type))],
      relations: [...new Set(data.edges.map(e => e.relation))],
    },
    graph: data,
  }, null, 2);
}

async function fetchGraphFromNeo4j(
  neo4jClient: Awaited<ReturnType<typeof tryConnectNeo4j>>,
  storage: ReturnType<typeof getStorage>,
  memoryId: string,
  depth: number,
  limit: number
): Promise<{ memories: Memory[]; relations: Array<{ source: Memory; target: Memory; relation: string }> }> {
  const memories: Memory[] = [];
  const relations: Array<{ source: Memory; target: Memory; relation: string }> = [];
  
  const sourceMemory = storage.getMemoryById(memoryId);
  if (!sourceMemory) return { memories, relations };
  
  memories.push(sourceMemory);

  if (neo4jClient) {
    const graphResult = await neo4jClient.getRelatedMemories(memoryId, depth);
    
    for (const node of graphResult.nodes) {
      if (node.id !== memoryId) {
        const mem = storage.getMemoryById(node.id);
        if (mem && memories.length < limit) {
          memories.push(mem);
        }
      }
    }

    for (const edge of graphResult.edges) {
      const source = memories.find(m => m.id === edge.source);
      const target = memories.find(m => m.id === edge.target);
      if (source && target) {
        relations.push({ source, target, relation: edge.type });
      }
    }
  } else {
    const allMemories = storage.getMemories({ limit: 500 });
    const relatedResult = findRelatedMemories(sourceMemory, allMemories, limit - 1);

    for (const { memory, relation, score } of relatedResult) {
      memories.push(memory);
      relations.push({ source: sourceMemory, target: memory, relation });
    }
  }

  return { memories, relations };
}

function findMemoryRelations(
  memories: Memory[],
  minScore: number = 0.3
): Array<{ source: Memory; target: Memory; relation: string; score: number }> {
  const relations: Array<{ source: Memory; target: Memory; relation: string; score: number }> = [];
  
  for (let i = 0; i < memories.length; i++) {
    const source = memories[i];
    const relatedResult = findRelatedMemories(source, memories.slice(i + 1), 5);
    
    for (const { memory: target, relation, score } of relatedResult) {
      if (score && score > minScore) {
        relations.push({ source, target, relation, score });
      }
    }
  }
  
  return relations;
}

export const memory_graph_visualize = tool({
  description: `Visualize the memory graph as ASCII art, Mermaid diagram, DOT/Graphviz, or JSON.

Shows memories as nodes and their relationships as edges. Supports multiple output formats:
- **ascii**: Terminal-friendly ASCII art visualization
- **mermaid**: Mermaid.js diagram (can be rendered in GitHub, VS Code, etc.)
- **dot**: Graphviz DOT format (can be rendered with dot/neato/etc.)
- **json**: Raw graph data in JSON format for programmatic use

When a memory_id is provided, shows the subgraph around that memory.
When scope or type filters are provided, shows matching memories and their connections.
Without filters, shows an overview of the entire memory graph.`,

  args: {
    format: tool.schema
      .enum(["ascii", "mermaid", "dot", "json"])
      .default("ascii")
      .describe("Output format for the visualization"),
    memory_id: tool.schema
      .string()
      .optional()
      .describe("Show graph centered on this memory (with related memories)"),
    scope: tool.schema
      .string()
      .optional()
      .describe("Filter to memories with this scope"),
    type: tool.schema
      .enum(["decision", "learning", "preference", "blocker", "context", "pattern"])
      .optional()
      .describe("Filter to memories of this type"),
    depth: tool.schema
      .number()
      .min(1)
      .max(4)
      .default(2)
      .describe("How many relationship hops to traverse from center (default: 2)"),
    limit: tool.schema
      .number()
      .min(1)
      .max(100)
      .default(30)
      .describe("Maximum number of nodes to include (default: 30)"),
  },

  async execute(args) {
    const { 
      format = "ascii", 
      memory_id, 
      scope, 
      type, 
      depth = 2, 
      limit = 30 
    } = args;

    try {
      const storage = getStorage();
      let memories: Memory[] = [];
      let relations: Array<{ source: Memory; target: Memory; relation: string; score?: number }> = [];

      const neo4jClient = await tryConnectNeo4j();

      if (memory_id) {
        const sourceMemory = storage.getMemoryById(memory_id);
        if (!sourceMemory) {
          return JSON.stringify({
            success: false,
            error: `Memory with ID '${memory_id}' not found`,
          }, null, 2);
        }

        const graphData = await fetchGraphFromNeo4j(neo4jClient, storage, memory_id, depth, limit);
        memories = graphData.memories;
        relations = graphData.relations;
      } else {
        const queryParams: { scope?: string; type?: MemoryType; limit: number } = { limit };
        if (scope) queryParams.scope = scope;
        if (type) queryParams.type = type;

        memories = storage.getMemories(queryParams);
        relations = findMemoryRelations(memories);
      }

      if (memories.length === 0) {
        return JSON.stringify({
          success: true,
          message: "No memories found matching the criteria.",
          format,
          visualization: format === "ascii" 
            ? "╔══════════════════════════════════════╗\n║   MEMORY GRAPH: Empty               ║\n║   No memories to visualize.         ║\n╚══════════════════════════════════════╝"
            : "",
        }, null, 2);
      }

      const graphData = buildGraphData(memories, relations);

      let visualization: string;
      switch (format as OutputFormat) {
        case "mermaid":
          visualization = renderMermaid(graphData);
          break;
        case "dot":
          visualization = renderDot(graphData);
          break;
        case "json":
          visualization = renderJson(graphData);
          break;
        case "ascii":
        default:
          visualization = renderAscii(graphData);
          break;
      }

      return JSON.stringify({
        success: true,
        format,
        source: neo4jClient ? "neo4j" : "sqlite",
        statistics: {
          nodes: graphData.nodes.length,
          edges: graphData.edges.length,
          types: [...new Set(graphData.nodes.map(n => n.type))],
        },
        visualization,
        tip: format === "mermaid" 
          ? "Paste the mermaid code in a .md file or https://mermaid.live to render"
          : format === "dot"
          ? "Save as .dot file and render with: dot -Tpng graph.dot -o graph.png"
          : undefined,
      }, null, 2);

    } catch (err) {
      return JSON.stringify({
        success: false,
        error: err instanceof Error ? err.message : "Unknown error generating graph visualization",
      }, null, 2);
    }
  },
});
