// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { Hypothesis } from "@prismalens/contracts";
import { describe, expect, it } from "vitest";
import { hypothesisTree } from "./hypothesis-tree";

const h = (
	statement: string,
	status: Hypothesis["status"],
	link: { id?: string; parentId?: string } = {},
): Hypothesis => ({ statement, status, evidence: [], ...link });

const report = (hypotheses: Hypothesis[], rootCause: string | null) => ({
	hypotheses,
	rootCause,
	summary: "What the run saw.",
});

describe("hypothesisTree (proposal item 5)", () => {
	it("nests linked hypotheses and marks the chain to the named cause", () => {
		const t = hypothesisTree(
			report(
				[
					h("Backend dependency latency", "confirmed", {
						id: "h3",
						parentId: "h1",
					}),
					h("Query engine slow down", "supported", { id: "h1" }),
					h("Faulty deployment", "refuted", { id: "h2" }),
					h("Network latency to DB", "refuted", { id: "h4", parentId: "h3" }),
				],
				"flight-db SELECT slowdown",
			),
		);
		expect(t.linked).toBe(true);
		expect(t.roots.map((n) => n.key)).toEqual(["h1", "h2"]);
		const [engine, deploy] = t.roots;
		expect(engine?.children.map((n) => n.key)).toEqual(["h3"]);
		expect(engine?.children[0]?.children.map((n) => n.key)).toEqual(["h4"]);
		expect(engine?.winning).toBe(true);
		expect(engine?.children[0]?.winning).toBe(true);
		expect(engine?.children[0]?.children[0]?.winning).toBe(false);
		expect(deploy?.winning).toBe(false);
		expect(t.end).toEqual({ kind: "cause", text: "flight-db SELECT slowdown" });
	});

	it("lists a report without links flat, in report order", () => {
		const t = hypothesisTree(
			report([h("A", "supported"), h("B", "speculative")], "A"),
		);
		expect(t.linked).toBe(false);
		expect(t.roots.map((n) => n.hypothesis.statement)).toEqual(["A", "B"]);
		expect(t.roots.every((n) => n.children.length === 0)).toBe(true);
		expect(t.roots[0]?.winning).toBe(true);
	});

	it("keeps a node whose link is unknown, to itself or into a cycle at the top", () => {
		const t = hypothesisTree(
			report(
				[
					h("Self", "speculative", { id: "a", parentId: "a" }),
					h("Ghost", "speculative", { id: "b", parentId: "zz" }),
					h("C1", "speculative", { id: "c", parentId: "d" }),
					h("C2", "speculative", { id: "d", parentId: "c" }),
				],
				null,
			),
		);
		const all = (ns: typeof t.roots): string[] =>
			ns.flatMap((n) => [n.key, ...all(n.children)]);
		expect(all(t.roots).sort()).toEqual(["a", "b", "c", "d"]);
		expect(t.roots.map((n) => n.key)).toEqual(
			expect.arrayContaining(["a", "b"]),
		);
	});

	it("ends in no cause found, with no winning chain, when the run named none", () => {
		const t = hypothesisTree(
			report([h("A", "supported", { id: "h1" }), h("B", "refuted")], null),
		);
		expect(t.end).toEqual({ kind: "none", text: "What the run saw." });
		expect(t.roots.some((n) => n.winning)).toBe(false);
	});
});
