// @vitest-environment happy-dom
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { CanonicalEvent } from "@prismalens/contracts";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TooltipProvider } from "@/components/ui/tooltip";
import { PrStatusNode } from "./PrStatusNode";

const navigate = vi.fn();
vi.mock("@tanstack/react-router", () => ({
	useNavigate: () => navigate,
}));

(
	globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
	navigate.mockClear();
	container = document.createElement("div");
	document.body.appendChild(container);
	root = createRoot(container);
});

afterEach(async () => {
	await act(async () => root.unmount());
	container.remove();
});

const base = {
	kind: "pr_status",
	runId: "run-1",
	branchId: "root",
	path: [],
	seq: 1,
	label: null,
	ts: "2026-11-12T00:00:00Z",
	prId: "pr-123",
	pr: "org/repo#412",
	phase: "noted",
};

const render = async (over: Record<string, unknown>) => {
	await act(async () => {
		root.render(
			<TooltipProvider>
				<PrStatusNode
					event={{ ...base, ...over } as unknown as CanonicalEvent}
					incidentId={null}
				/>
			</TooltipProvider>,
		);
	});
	return container.querySelector<HTMLButtonElement>(
		'[data-testid="pr-status-line"]',
	);
};

// The line became marks with the sentence in its label (fix(frontend): PR events are one line of marks).
describe("PrStatusNode (#1101)", () => {
	it("draws a failed check as the PR number, what is not passing and the short SHA, with every count in its label", async () => {
		const line = await render({
			tone: "failing",
			lines: ["CI failed: unit tests on 9f3c2ab"],
			checks: { state: "failing", total: 9, failed: 1, pending: 1 },
			marks: [
				{ kind: "check", state: "failing", sha: "9f3c2ab", name: "unit tests" },
			],
		});
		expect(line?.getAttribute("data-tone")).toBe("failing");
		// d0739b420 replaced the 7/9 fraction with words.
		expect(line?.getAttribute("aria-label")).toBe(
			"PR #412, Failing, 7 of 9 checks passing · 1 failing · 1 running: CI failed: unit tests on 9f3c2ab",
		);
		expect(line?.textContent).toBe("#4121 failing · 1 running9f3c2ab");
		const checks = container.querySelector('[data-testid="pr-status-checks"]');
		expect(checks?.getAttribute("data-state")).toBe("failing");
		expect(checks?.className).toContain("text-danger");
		const check = container.querySelector(
			'[data-mark="checks"][data-state="failing"]:not([data-testid])',
		);
		expect(check?.textContent).toBe("9f3c2ab");

		await act(async () => line?.click());
		expect(navigate).toHaveBeenCalledTimes(1);
		const search = navigate.mock.calls[0]?.[0].search as (
			s: Record<string, unknown>,
		) => Record<string, unknown>;
		expect(search({ tab: "x" })).toEqual({
			tab: "x",
			panel: "thread",
			section: "pull-requests:pr-123",
		});
	});

	it("draws a review as the reviewer's initial and the verdict mark", async () => {
		const line = await render({
			tone: "attention",
			lines: ["Review: @dana requested changes"],
			marks: [{ kind: "review", state: "changes_requested", name: "dana" }],
		});
		const review = container.querySelector('[data-mark="review"]');
		expect(review?.getAttribute("data-state")).toBe("changes_requested");
		expect(review?.textContent).toBe("D");
		expect(review?.querySelector("svg")?.getAttribute("class")).toContain(
			"text-warn",
		);
		expect(line?.getAttribute("aria-label")).toBe(
			"PR #412, Needs attention: Review: @dana requested changes",
		);
	});

	it("folds changes past the fourth into +N", async () => {
		const lines = Array.from(
			{ length: 6 },
			(_, i) => `CI failed: t${i} on abc${i}`,
		);
		await render({
			tone: "failing",
			lines,
			marks: lines.map((_, i) => ({
				kind: "check",
				state: "failing",
				sha: `abc${i}`,
			})),
		});
		expect(
			container.querySelectorAll('[data-mark="checks"][data-state="failing"]'),
		).toHaveLength(4);
		expect(
			container.querySelector('[data-testid="pr-status-line"]')?.textContent,
		).toBe("#412abc0abc1abc2abc3+2");
	});

	it("keeps an older record with no tone, checks or marks to the number, with its text in the label", async () => {
		const line = await render({ lines: ["Updated status"] });
		expect(line?.getAttribute("data-tone")).toBe("unknown");
		expect(line?.textContent).toBe("#412");
		expect(line?.getAttribute("aria-label")).toBe("PR #412: Updated status");
	});
});
