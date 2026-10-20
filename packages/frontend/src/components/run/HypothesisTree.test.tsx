// @vitest-environment happy-dom
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { Hypothesis } from "@prismalens/contracts";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { hypothesisTree } from "@/lib/hypothesis-tree";
import { HypothesisTree } from "./HypothesisTree";
import { evidenceRow } from "./run-details";

(
	globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
	container = document.createElement("div");
	document.body.appendChild(container);
	root = createRoot(container);
});

afterEach(async () => {
	await act(async () => root.unmount());
	container.remove();
});

const cited: Hypothesis["evidence"][number] = {
	observation: "Pool size set to 5",
	source: "src/db/pool.ts:42",
	direction: "supports",
	status: "verified",
	toolCallId: "call-1",
};

async function render(hypotheses: Hypothesis[], rootCause: string | null) {
	await act(async () =>
		root.render(
			<HypothesisTree
				tree={hypothesisTree({ hypotheses, rootCause, summary: "Seen." })}
				incidentId="inc-1"
				rowOf={(e) => evidenceRow(e, (x) => (x.toolCallId ? 3 : undefined))}
				onJump={() => {}}
			/>,
		),
	);
}

const q = (sel: string) =>
	Array.from(container.querySelectorAll<HTMLElement>(sel));

describe("HypothesisTree (proposal item 5)", () => {
	it("draws linked hypotheses nested, the winning chain marked, its evidence open at the cited step", async () => {
		await render(
			[
				{
					statement: "Pool exhausted",
					status: "confirmed",
					evidence: [cited],
					id: "h2",
					parentId: "h1",
				},
				{ statement: "DB slow", status: "supported", evidence: [], id: "h1" },
				{ statement: "Bad deploy", status: "refuted", evidence: [], id: "h3" },
			],
			"Connection pool exhausted",
		);
		const tree = q("[data-testid=hypothesis-tree]")[0];
		expect(tree?.hasAttribute("data-linked")).toBe(true);
		expect(q("[data-winning]").map((n) => n.dataset.status)).toEqual([
			"supported",
			"confirmed",
		]);
		const nested = q("ol ol [data-testid=hypothesis-node]");
		expect(nested.map((n) => n.dataset.status)).toEqual(["confirmed"]);
		const ev = q("[data-testid=hypothesis-evidence]")[0];
		expect(ev?.textContent).toContain("src/db/pool.ts:42");
		expect(ev?.querySelector("[data-testid=detail-step]")?.textContent).toBe(
			"Step 3",
		);
		const end = q("[data-testid=hypothesis-end]")[0];
		expect(end?.dataset.end).toBe("cause");
		expect(end?.textContent).toContain("Connection pool exhausted");
	});

	it("strikes a refuted hypothesis and says it was ruled out", async () => {
		await render(
			[{ statement: "Bad deploy", status: "refuted", evidence: [] }],
			null,
		);
		const node = q("[data-status=refuted]")[0];
		const statement = node?.querySelector("[data-testid=hypothesis-statement]");
		expect(statement?.className).toContain("line-through");
		expect(node?.textContent).toContain("Ruled out");
	});

	it("lists an unlinked report flat and ends in No cause found", async () => {
		await render(
			[
				{ statement: "A", status: "supported", evidence: [cited] },
				{ statement: "B", status: "speculative", evidence: [] },
			],
			null,
		);
		expect(
			q("[data-testid=hypothesis-tree]")[0]?.hasAttribute("data-linked"),
		).toBe(false);
		expect(q("ol ol").length).toBe(0);
		expect(q("[data-testid=hypothesis-node]").length).toBe(2);
		expect(q("[data-winning]").length).toBe(0);
		const end = q("[data-testid=hypothesis-end]")[0];
		expect(end?.dataset.end).toBe("none");
		expect(end?.textContent).toContain("No cause found");
	});
});
