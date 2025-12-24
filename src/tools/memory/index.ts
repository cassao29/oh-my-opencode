export { memory_remember } from "./remember";
export { memory_recall } from "./recall";
export { memory_smart_recall } from "./smart-recall";
export { memory_search } from "./search";
export { memory_update } from "./update";
export { memory_forget } from "./forget";
export { memory_list } from "./list";
export { memory_analytics } from "./analytics";
export { memory_cleanup } from "./cleanup";
export { memory_export } from "./export";
export { memory_related } from "./related";
export { memory_prune_advice } from "./prune-advice";
export { memory_context_analytics } from "./context-analytics";
export { memory_semantic_search } from "./semantic-search";
export { memory_graph_visualize } from "./graph-visualize";

export const memoryTools = {
  memory_remember: () => import("./remember").then(m => m.memory_remember),
  memory_recall: () => import("./recall").then(m => m.memory_recall),
  memory_smart_recall: () => import("./smart-recall").then(m => m.memory_smart_recall),
  memory_search: () => import("./search").then(m => m.memory_search),
  memory_update: () => import("./update").then(m => m.memory_update),
  memory_forget: () => import("./forget").then(m => m.memory_forget),
  memory_list: () => import("./list").then(m => m.memory_list),
  memory_analytics: () => import("./analytics").then(m => m.memory_analytics),
  memory_cleanup: () => import("./cleanup").then(m => m.memory_cleanup),
  memory_export: () => import("./export").then(m => m.memory_export),
  memory_related: () => import("./related").then(m => m.memory_related),
  memory_prune_advice: () => import("./prune-advice").then(m => m.memory_prune_advice),
  memory_context_analytics: () => import("./context-analytics").then(m => m.memory_context_analytics),
  memory_semantic_search: () => import("./semantic-search").then(m => m.memory_semantic_search),
  memory_graph_visualize: () => import("./graph-visualize").then(m => m.memory_graph_visualize),
};
