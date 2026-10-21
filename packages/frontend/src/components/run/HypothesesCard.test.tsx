// @vitest-environment happy-dom
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { Evidence, Hypothesis } from "@prismalens/contracts";
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type CiteTarget, HypothesesCard } from "./HypothesesCard";

if (typeof globalThis.ResizeObserver === "undefined") {
	globalThis.ResizeObserver = class ResizeObserver {
		observe() {}
		unobserve() {}
		disconnect() {}
	};
}

vi.mock("@/components/shared/Hint", () => ({
	Hint: ({ children }: { children: ReactNode }) => children,
}));

(
	globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

const q = <T extends Element>(testId: string) =>
	container.querySelector(`[data-testid="${testId}"]`) as T;
const qAll = <T extends Element>(testId: string) =>
	Array.from(container.querySelectorAll(`[data-testid="${testId}"]`)) as T[];

beforeEach(() => {
	container = document.createElement("div");
	document.body.appendChild(container);
	root = createRoot(container);
});

afterEach(async () => {
	await act(async () => root.unmount());
	container.remove();
	vi.restoreAllMocks();
});

const sampleHypotheses: Hypothesis[] = [
	{
		id: "h1",
		statement: "Connection pool exhaustion under load",
		status: "confirmed",
		evidence: [
			{
				observation: "high waiters",
				source: "src/db/pool.ts:41-42",
				direction: "supports",
				status: "verified",
			},
		],
	},
	{
		id: "h2",
		parentId: "h1",
		statement: "Stale connection timeouts not clearing",
		status: "supported",
		evidence: [
			{
				observation: "logs confirm",
				source: "step:5",
				direction: "supports",
				status: "verified",
			},
		],
	},
	{
		id: "h3",
		parentId: "h1",
		statement: "DNS resolution latency",
		status: "speculative",
		evidence: [],
	},
	{
		id: "h4",
		statement: "Network partition to database",
		status: "refuted",
		evidence: [],
	},
	{
		id: "h5",
		statement: "Garbage collection pause spike",
		status: "supported",
		evidence: [],
	},
	{
		id: "h6",
		parentId: "h5",
		statement: "Memory leak in query cache",
		status: "speculative",
		evidence: [],
	},
];

const sampleTargetOf = (e: Evidence): CiteTarget | null => {
	if (e.source === "src/db/pool.ts:41-42") {
		return {
			file: {
				repo: "prismalens",
				sha: "abcdef1",
				path: "src/db/pool.ts",
				line: 41,
				end: 42,
			},
		};
	}
	if (e.source === "step:5") {
		return { step: 5 };
	}
	return null;
};

describe("HypothesesCard", () => {
	it("renders card header, hypothesis count, rows and their status words", async () => {
		const onOpenFile = vi.fn();
		const onJump = vi.fn();
		const onPreview = vi.fn();

		await act(async () => {
			root.render(
				<HypothesesCard
					report={{
						rootCause: "DB pool exhaustion caused timeout cascading",
						hypotheses: sampleHypotheses,
					}}
					at="2026-10-21T12:00:00Z"
					targetOf={sampleTargetOf}
					onOpenFile={onOpenFile}
					onJump={onJump}
					onPreview={onPreview}
					preview={false}
				/>,
			);
		});

		const card = q("hypotheses-card");
		expect(card.textContent).toContain("Hypotheses");
		expect(card.textContent).toContain("6 hypotheses.");

		const rows = qAll("hypothesis-row");
		expect(rows).toHaveLength(6);

		expect(rows[0]?.textContent).toContain("Confirmed");
		expect(rows[1]?.textContent).toContain("Likely");
		expect(rows[2]?.textContent).toContain("Unconfirmed");
		expect(rows[3]?.textContent).toContain("Ruled out");
		expect(rows[4]?.textContent).toContain("Likely");
		expect(rows[5]?.textContent).toContain("Unconfirmed");
	});

	it("shows the Conclusion block when rootCause is present and omits it when null", async () => {
		await act(async () => {
			root.render(
				<HypothesesCard
					report={{
						rootCause: "DB pool exhaustion caused timeout cascading",
						hypotheses: sampleHypotheses,
					}}
					at="2026-10-21T12:00:00Z"
					targetOf={sampleTargetOf}
					onOpenFile={vi.fn()}
					onJump={vi.fn()}
					onPreview={vi.fn()}
					preview={false}
				/>,
			);
		});

		expect(container.textContent).toContain("Conclusion");
		expect(container.textContent).toContain(
			"DB pool exhaustion caused timeout cascading",
		);

		await act(async () => {
			root.render(
				<HypothesesCard
					report={{
						rootCause: null,
						hypotheses: sampleHypotheses,
					}}
					at="2026-10-21T12:00:00Z"
					targetOf={sampleTargetOf}
					onOpenFile={vi.fn()}
					onJump={vi.fn()}
					onPreview={vi.fn()}
					preview={false}
				/>,
			);
		});

		expect(container.textContent).not.toContain("Conclusion");
	});

	it("calls onOpenFile with FileAt and origin id on file citation, and onJump on step citation", async () => {
		const onOpenFile = vi.fn();
		const onJump = vi.fn();

		await act(async () => {
			root.render(
				<HypothesesCard
					report={{
						rootCause: "Root cause",
						hypotheses: sampleHypotheses,
					}}
					at="2026-10-21T12:00:00Z"
					targetOf={sampleTargetOf}
					onOpenFile={onOpenFile}
					onJump={onJump}
					onPreview={vi.fn()}
					preview={false}
				/>,
			);
		});

		const fileCiteBtn = container.querySelector(
			'button[id="hyp-card-cite-1"]',
		) as HTMLButtonElement;
		expect(fileCiteBtn).not.toBeNull();
		await act(async () => {
			fileCiteBtn.click();
		});

		expect(onOpenFile).toHaveBeenCalledTimes(1);
		expect(onOpenFile).toHaveBeenCalledWith(
			{
				repo: "prismalens",
				sha: "abcdef1",
				path: "src/db/pool.ts",
				line: 41,
				end: 42,
			},
			"hyp-card-cite-1",
		);

		const stepCiteBtn = container.querySelector(
			'button[id="hyp-card-cite-2"]',
		) as HTMLButtonElement;
		expect(stepCiteBtn).not.toBeNull();
		await act(async () => {
			stepCiteBtn.click();
		});

		expect(onJump).toHaveBeenCalledTimes(1);
		expect(onJump).toHaveBeenCalledWith(5);
	});

	it("calls onPreview(true) when clicking hypotheses-open button", async () => {
		const onPreview = vi.fn();

		await act(async () => {
			root.render(
				<HypothesesCard
					report={{
						rootCause: "Root cause",
						hypotheses: sampleHypotheses,
					}}
					at="2026-10-21T12:00:00Z"
					targetOf={sampleTargetOf}
					onOpenFile={vi.fn()}
					onJump={vi.fn()}
					onPreview={onPreview}
					preview={false}
				/>,
			);
		});

		const openBtn = q<HTMLButtonElement>("hypotheses-open");
		expect(openBtn).not.toBeNull();
		await act(async () => {
			openBtn.click();
		});

		expect(onPreview).toHaveBeenCalledTimes(1);
		expect(onPreview).toHaveBeenCalledWith(true);
	});

	it("renders empty state when hypotheses is empty", async () => {
		await act(async () => {
			root.render(
				<HypothesesCard
					report={{
						rootCause: null,
						hypotheses: [],
					}}
					at="2026-10-21T12:00:00Z"
					targetOf={sampleTargetOf}
					onOpenFile={vi.fn()}
					onJump={vi.fn()}
					onPreview={vi.fn()}
					preview={false}
				/>,
			);
		});

		const card = q("hypotheses-card");
		expect(card.textContent).toContain("No hypotheses.");
		expect(card.textContent).toContain("The report lists no hypotheses.");
	});

	it("renders fallback text and preserves hypotheses when drawing throws an error", async () => {
		vi.spyOn(console, "error").mockImplementation(() => {});

		const badHypotheses: Hypothesis[] = [
			{
				id: "h1",
				statement: "Invalid status hypothesis",
				status: "nonexistent-status" as unknown as Hypothesis["status"],
				evidence: [],
			},
			{
				id: "h2",
				statement: "Second hypothesis",
				status: "supported",
				evidence: [],
			},
		];

		await act(async () => {
			root.render(
				<HypothesesCard
					report={{
						rootCause: "Fallback root cause",
						hypotheses: badHypotheses,
					}}
					at="2026-10-21T12:00:00Z"
					targetOf={sampleTargetOf}
					onOpenFile={vi.fn()}
					onJump={vi.fn()}
					onPreview={vi.fn()}
					preview={false}
				/>,
			);
		});

		const fallback = q("hypotheses-fallback");
		expect(fallback).not.toBeNull();
		expect(fallback.textContent).toContain(
			"Unable to show the hypotheses drawing",
		);
		expect(fallback.textContent).toContain("Invalid status hypothesis");
		expect(fallback.textContent).toContain("Second hypothesis");
	});
});
