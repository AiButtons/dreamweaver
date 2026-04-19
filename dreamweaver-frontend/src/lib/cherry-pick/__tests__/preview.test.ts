import { describe, expect, it } from "bun:test";
import { summarizeCherryPick } from "@/lib/cherry-pick/preview";

describe("summarizeCherryPick", () => {
  it("summarizes a well-formed 3-op array with correct counts and dedup", () => {
    const ops = [
      { op: "create_node", nodeId: "n1" },
      { op: "create_node", nodeId: "n2" },
      { op: "update_node", nodeId: "n1" },
    ];
    const summary = summarizeCherryPick(JSON.stringify(ops));
    expect(summary.invalid).toBeUndefined();
    expect(summary.totalOps).toBe(3);
    expect(summary.opCounts).toEqual({ create_node: 2, update_node: 1 });
    expect(summary.touchedNodeIds).toEqual(["n1", "n2"]);
    expect(summary.touchedEdgeIds).toEqual([]);
  });

  it("returns an empty summary for an empty array", () => {
    const summary = summarizeCherryPick("[]");
    expect(summary.invalid).toBeUndefined();
    expect(summary.totalOps).toBe(0);
    expect(summary.opCounts).toEqual({});
    expect(summary.touchedNodeIds).toEqual([]);
    expect(summary.touchedEdgeIds).toEqual([]);
  });

  it("flags malformed JSON as invalid and zeroes counts", () => {
    const summary = summarizeCherryPick("{");
    expect(summary.invalid).toBeDefined();
    expect(summary.totalOps).toBe(0);
    expect(summary.opCounts).toEqual({});
    expect(summary.touchedNodeIds).toEqual([]);
    expect(summary.touchedEdgeIds).toEqual([]);
  });

  it("flags a root object (non-array) payload as invalid", () => {
    const summary = summarizeCherryPick('{"op":"create_node"}');
    expect(summary.invalid).toBeDefined();
    expect(summary.totalOps).toBe(0);
    expect(summary.opCounts).toEqual({});
  });

  it("counts ops missing the op field under 'unknown'", () => {
    const ops = [{ nodeId: "n1" }, { op: "create_node", nodeId: "n2" }];
    const summary = summarizeCherryPick(JSON.stringify(ops));
    expect(summary.invalid).toBeUndefined();
    expect(summary.totalOps).toBe(2);
    expect(summary.opCounts).toEqual({ unknown: 1, create_node: 1 });
  });

  it("collects nodeIds from create_node and delete_node and preserves first-appearance order", () => {
    const ops = [
      { op: "create_node", nodeId: "n3" },
      { op: "delete_node", nodeId: "n1" },
      { op: "update_node", nodeId: "n3" },
      { op: "delete_node", nodeId: "n2" },
    ];
    const summary = summarizeCherryPick(JSON.stringify(ops));
    expect(summary.touchedNodeIds).toEqual(["n3", "n1", "n2"]);
    expect(summary.opCounts).toEqual({ create_node: 1, delete_node: 2, update_node: 1 });
  });

  it("collects edgeIds from edge operations", () => {
    const ops = [
      { op: "create_edge", edgeId: "e1" },
      { op: "update_edge", edgeId: "e2" },
      { op: "delete_edge", edgeId: "e1" },
    ];
    const summary = summarizeCherryPick(JSON.stringify(ops));
    expect(summary.touchedEdgeIds).toEqual(["e1", "e2"]);
    expect(summary.touchedNodeIds).toEqual([]);
  });
});
