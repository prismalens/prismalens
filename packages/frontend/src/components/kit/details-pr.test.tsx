// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { detailsRows, type ThreadDetails } from "./details-registry";

vi.mock("@/components/shared/Hint", () => ({
	Hint: ({ children }: { children: ReactNode }) => children,
}));

const thread = (pr: ThreadDetails["pr"]): ThreadDetails => ({
	kind: "thread",
	agent: { id: "claude", name: "Claude Code" },
	pr,
});
const html = (n: ReactNode) => renderToStaticMarkup(<>{n}</>);

describe("the details card's PR row (#1101 bar 15.1)", () => {
	const rows = detailsRows(
		thread({
			number: 412,
			word: "Failing",
			tone: "failing",
			checks: "7/9",
			title: "Fix the slow orders query",
			branches: { head: "pl/orders-index", base: "main" },
			review: { state: "changes_requested", word: "Changes requested" },
			merge: { state: "conflicts", word: "Merge conflict" },
		}),
	);
	const pr = rows.find((r) => r.id === "pr");

	it("names the PR by number and title", () => {
		expect(html(pr?.label)).toContain("#412");
		expect(html(pr?.label)).toContain("Fix the slow orders query");
	});

	it("marks the review verdict and merge state beside the state word and checks", () => {
		const value = html(pr?.value);
		expect(value).toContain('aria-label="Review: Changes requested"');
		expect(value).toContain('aria-label="Merge: Merge conflict"');
		expect(value).toContain("Failing 7/9");
	});

	it("puts the branch pair on its own row, full density only", () => {
		const b = rows.find((r) => r.id === "pr-branches");
		expect(html(b?.label).replace(/<[^>]+>/g, "")).toBe(
			"pl/orders-indexmerges intomain",
		);
		expect(b?.priority).toBe(3);
	});

	it("draws no marks and no branch row when the host gave none", () => {
		const bare = detailsRows(
			thread({ number: 9, word: "Open", tone: "passing" }),
		);
		expect(html(bare.find((r) => r.id === "pr")?.value)).not.toContain(
			'role="img"',
		);
		expect(bare.some((r) => r.id === "pr-branches")).toBe(false);
	});
});
