// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { Hypothesis } from "@prismalens/contracts";
import { describe, expect, it } from "vitest";
import {
	hypothesisTree,
	STATUS_WORD,
	type HypothesisNode,
} from "./hypothesis-tree";

const h = (statement: string, over: Partial<Hypothesis> = {}): Hypothesis => ({
	statement,
	status: "supported",
	evidence: [],
	...over,
});

function flatten(nodes: readonly HypothesisNode[]): Hypothesis[] {
	const result: Hypothesis[] = [];
	for (const node of nodes) {
		result.push(node.hypothesis);
		result.push(...flatten(node.children));
	}
	return result;
}

describe("hypothesisTree", () => {
	it("nests children under the parent their parentId names, in report order", () => {
		const root = h("root", { id: "a" });
		const child1 = h("child 1", { id: "b", parentId: "a" });
		const child2 = h("child 2", { id: "c", parentId: "a" });
		const grandChild = h("grandchild", { id: "d", parentId: "b" });
		const input = [root, child1, child2, grandChild];

		const tree = hypothesisTree(input);

		expect(tree).toHaveLength(1);
		expect(tree[0]?.hypothesis).toBe(root);
		expect(tree[0]?.index).toBe(0);
		expect(tree[0]?.children.map((c) => c.hypothesis)).toEqual([child1, child2]);
		expect(tree[0]?.children[0]?.index).toBe(1);
		expect(tree[0]?.children[1]?.index).toBe(2);
		expect(tree[0]?.children[0]?.children.map((c) => c.hypothesis)).toEqual([grandChild]);
		expect(tree[0]?.children[0]?.children[0]?.index).toBe(3);
		const flat = flatten(tree);
		expect(flat).toHaveLength(input.length);
		expect(new Set(flat)).toEqual(new Set(input));
	});

	it("puts a node at the top when parentId names no hypothesis", () => {
		const node = h("orphan", { id: "a", parentId: "unknown-parent" });
		const input = [node];

		const tree = hypothesisTree(input);

		expect(tree).toHaveLength(1);
		expect(tree[0]?.hypothesis).toBe(node);
		expect(tree[0]?.index).toBe(0);
		expect(tree[0]?.children).toEqual([]);
		const flat = flatten(tree);
		expect(flat).toHaveLength(input.length);
		expect(new Set(flat)).toEqual(new Set(input));
	});

	it("puts a node at the top when it names itself as parent", () => {
		const node = h("self-referential", { id: "a", parentId: "a" });
		const input = [node];

		const tree = hypothesisTree(input);

		expect(tree).toHaveLength(1);
		expect(tree[0]?.hypothesis).toBe(node);
		expect(tree[0]?.index).toBe(0);
		expect(tree[0]?.children).toEqual([]);
		const flat = flatten(tree);
		expect(flat).toHaveLength(input.length);
		expect(new Set(flat)).toEqual(new Set(input));
	});

	it("preserves both nodes and loses neither in a two-node cycle", () => {
		const nodeF = h("f", { id: "f", parentId: "g" });
		const nodeG = h("g", { id: "g", parentId: "f" });
		const input = [nodeF, nodeG];

		const tree = hypothesisTree(input);

		expect(tree).toHaveLength(1);
		expect(tree[0]?.hypothesis).toBe(nodeF);
		expect(tree[0]?.index).toBe(0);
		expect(tree[0]?.children).toHaveLength(1);
		expect(tree[0]?.children[0]?.hypothesis).toBe(nodeG);
		expect(tree[0]?.children[0]?.index).toBe(1);
		expect(tree[0]?.children[0]?.children).toEqual([]);
		const flat = flatten(tree);
		expect(flat).toHaveLength(input.length);
		expect(new Set(flat)).toEqual(new Set(input));
	});

	it("resolves a child's parentId to the first hypothesis when two share an id", () => {
		const firstA = h("first a", { id: "dup" });
		const secondA = h("second a", { id: "dup" });
		const child = h("child", { id: "c", parentId: "dup" });
		const input = [firstA, secondA, child];

		const tree = hypothesisTree(input);

		expect(tree).toHaveLength(2);
		expect(tree[0]?.hypothesis).toBe(firstA);
		expect(tree[0]?.index).toBe(0);
		expect(tree[0]?.children.map((c) => c.hypothesis)).toEqual([child]);
		expect(tree[0]?.children[0]?.index).toBe(2);
		expect(tree[1]?.hypothesis).toBe(secondA);
		expect(tree[1]?.index).toBe(1);
		expect(tree[1]?.children).toEqual([]);
		const flat = flatten(tree);
		expect(flat).toHaveLength(input.length);
		expect(new Set(flat)).toEqual(new Set(input));
	});

	it("puts a hypothesis with no id at the top", () => {
		const anonymous = h("no id");
		const input = [anonymous];

		const tree = hypothesisTree(input);

		expect(tree).toHaveLength(1);
		expect(tree[0]?.hypothesis).toBe(anonymous);
		expect(tree[0]?.index).toBe(0);
		expect(tree[0]?.children).toEqual([]);
		const flat = flatten(tree);
		expect(flat).toHaveLength(input.length);
		expect(new Set(flat)).toEqual(new Set(input));
	});
});

describe("STATUS_WORD", () => {
	it("maps confirmed, supported, speculative, refuted to Confirmed, Likely, Unconfirmed, Ruled out", () => {
		expect(STATUS_WORD.confirmed).toBe("Confirmed");
		expect(STATUS_WORD.supported).toBe("Likely");
		expect(STATUS_WORD.speculative).toBe("Unconfirmed");
		expect(STATUS_WORD.refuted).toBe("Ruled out");
	});
});
