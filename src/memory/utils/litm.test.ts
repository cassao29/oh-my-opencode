import { describe, expect, it } from "bun:test";
import {
  litmReorder,
  litmReorderWithPositions,
  litmReorderText,
  buildLitmAwareContext,
  litmReorderByScore,
  applyLitm,
} from "./litm";

describe("litmReorder", () => {
  it("should return empty array for empty input", () => {
    expect(litmReorder([])).toEqual([]);
  });

  it("should return same array for single item", () => {
    expect(litmReorder([1])).toEqual([1]);
  });

  it("should return same array for two items", () => {
    expect(litmReorder([1, 2])).toEqual([1, 2]);
  });

  it("should reorder [1,2,3] with important items at edges", () => {
    const result = litmReorder([1, 2, 3]);
    expect(result).toHaveLength(3);
    expect(result.includes(1)).toBe(true);
    expect(result.includes(2)).toBe(true);
    expect(result.includes(3)).toBe(true);
  });

  it("should reorder [1,2,3,4,5,6] with important items at edges", () => {
    const result = litmReorder([1, 2, 3, 4, 5, 6]);
    expect(result[0]).toBe(1);
    expect(result[result.length - 1]).toBe(2);
  });

  it("should place odd-ranked items at start, even at end for larger arrays", () => {
    const input = [1, 2, 3, 4, 5, 6, 7, 8];
    const result = litmReorder(input);
    expect(result[0]).toBe(1);
    expect(result[result.length - 1]).toBe(2);
    expect(result.includes(3)).toBe(true);
    expect(result.includes(4)).toBe(true);
  });
});

describe("litmReorderWithPositions", () => {
  it("should track positions correctly", () => {
    const result = litmReorderWithPositions([1, 2, 3]);
    expect(result[0].newPosition).toBe("start");
    expect(result[result.length - 1].newPosition).toBe("end");
  });

  it("should preserve original index", () => {
    const result = litmReorderWithPositions(["a", "b", "c"]);
    const aItem = result.find((r) => r.item === "a");
    expect(aItem?.originalIndex).toBe(0);
  });
});

describe("litmReorderText", () => {
  it("should reorder text chunks", () => {
    const text = "First\n\nSecond\n\nThird";
    const result = litmReorderText(text);
    expect(result).toContain("First");
    expect(result).toContain("Second");
    expect(result).toContain("Third");
  });

  it("should handle single chunk", () => {
    const text = "Only one chunk";
    expect(litmReorderText(text)).toBe(text);
  });
});

describe("buildLitmAwareContext", () => {
  it("should place critical at start and end", () => {
    const result = buildLitmAwareContext(
      ["NEVER do X"],
      ["Important A", "Important B"],
      ["Background info"]
    );
    expect(result.startsWith("## CRITICAL")).toBe(true);
    expect(result.endsWith("NEVER do X")).toBe(true);
  });

  it("should include all sections", () => {
    const result = buildLitmAwareContext(
      ["Critical"],
      ["Important"],
      ["Background"]
    );
    expect(result).toContain("CRITICAL CONSTRAINTS");
    expect(result).toContain("IMPORTANT CONTEXT");
    expect(result).toContain("BACKGROUND");
    expect(result).toContain("REMINDER");
  });
});

describe("litmReorderByScore", () => {
  it("should sort by score then apply LITM", () => {
    const items = [
      { id: 1, score: 0.5 },
      { id: 2, score: 0.9 },
      { id: 3, score: 0.3 },
    ];
    const result = litmReorderByScore(items, (i) => i.score);
    expect(result).toHaveLength(3);
    expect(result.map(i => i.id).includes(2)).toBe(true);
  });
});

describe("applyLitm", () => {
  it("should not apply for less than minItems", () => {
    const items = [1, 2];
    expect(applyLitm(items)).toEqual([1, 2]);
  });

  it("should apply for 3+ items by default", () => {
    const items = [1, 2, 3];
    const result = applyLitm(items);
    expect(result).not.toEqual(items);
  });

  it("should respect enabled=false", () => {
    const items = [1, 2, 3, 4, 5];
    expect(applyLitm(items, { enabled: false })).toEqual(items);
  });

  it("should respect custom minItems", () => {
    const items = [1, 2, 3, 4];
    expect(applyLitm(items, { minItems: 5 })).toEqual(items);
  });
});
