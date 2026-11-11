// @vitest-environment happy-dom
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CompactionNode, LimitNode, limitNodeLine } from "./SessionNodes";

const clock = (at: string) => at.slice(11, 16);

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

describe("CompactionNode", () => {
	it("CompactionNode completed shows Compacted · 142k to 18k tokens, Agent command, and Kept: keep the API notes", async () => {
		await act(async () =>
			root.render(
				<CompactionNode
					event={{
						phase: "completed",
						method: "agent_command",
						before: 142_000,
						after: 18_000,
						instructions: "keep the API notes",
					}}
				/>,
			),
		);
		const node = container.querySelector('[data-testid="node-compaction"]');
		expect(node?.textContent).toContain("Compacted · 142k to 18k tokens");
		const method = container.querySelector(
			'[data-testid="node-compaction-method"]',
		);
		expect(method?.textContent).toBe("Agent command");
		const focus = container.querySelector(
			'[data-testid="node-compaction-focus"]',
		);
		expect(focus?.textContent).toBe("Kept: keep the API notes");
	});

	it("CompactionNode failed with reason No session and onRetry shows Compaction failed, No session, and Retry calls onRetry once", async () => {
		const onRetry = vi.fn();
		await act(async () =>
			root.render(
				<CompactionNode
					event={{
						phase: "failed",
						method: "agent_command",
						reason: "No session",
					}}
					onRetry={onRetry}
				/>,
			),
		);
		const node = container.querySelector('[data-testid="node-compaction"]');
		expect(node?.textContent).toContain("Compaction failed");
		expect(node?.textContent).toContain("No session");
		const retryButton = container.querySelector(
			'[data-testid="node-compaction-retry"]',
		) as HTMLButtonElement;
		await act(async () => {
			retryButton.click();
		});
		expect(onRetry).toHaveBeenCalledTimes(1);
	});

	it("CompactionNode started shows Compacting and no Retry", async () => {
		await act(async () =>
			root.render(
				<CompactionNode
					event={{
						phase: "started",
						method: "agent_command",
					}}
				/>,
			),
		);
		const node = container.querySelector('[data-testid="node-compaction"]');
		expect(node?.textContent).toContain("Compacting");
		expect(
			container.querySelector('[data-testid="node-compaction-retry"]'),
		).toBeNull();
	});
});

describe("limitNodeLine with the fixed clock", () => {
	it("usage_limit with resetsAt gives agent reached its usage limit · resets 15:45", () => {
		const line = limitNodeLine(
			{
				kind: "usage_limit",
				agent: "Codex",
				resetsAt: "2026-11-11T15:45:00.000Z",
			},
			clock,
		);
		expect(line).toBe("Codex reached its usage limit · resets 15:45");
	});

	it("usage_limit without resetsAt gives agent reached its usage limit", () => {
		const line = limitNodeLine(
			{
				kind: "usage_limit",
				agent: "Codex",
			},
			clock,
		);
		expect(line).toBe("Codex reached its usage limit");
	});

	it("resume_scheduled at 16:10 attempt 1 gives Resumes at 16:10", () => {
		const line = limitNodeLine(
			{
				kind: "resume_scheduled",
				at: "2026-11-11T16:10:00.000Z",
				attempt: 1,
			},
			clock,
		);
		expect(line).toBe("Resumes at 16:10");
	});

	it("resume_scheduled at 16:10 attempt 3 gives Trying again at 16:10 (try 3)", () => {
		const line = limitNodeLine(
			{
				kind: "resume_scheduled",
				at: "2026-11-11T16:10:00.000Z",
				attempt: 3,
			},
			clock,
		);
		expect(line).toBe("Trying again at 16:10 (try 3)");
	});

	it("resume_scheduled with gaveUp gives Stopped trying to resume", () => {
		const line = limitNodeLine(
			{
				kind: "resume_scheduled",
				at: "2026-11-11T16:10:00.000Z",
				gaveUp: true,
			},
			clock,
		);
		expect(line).toBe("Stopped trying to resume");
	});

	it("resumed limit_reset gives Resumed after the limit reset", () => {
		const line = limitNodeLine(
			{
				kind: "resumed",
				reason: "limit_reset",
			},
			clock,
		);
		expect(line).toBe("Resumed after the limit reset");
	});
});

describe("LimitNode", () => {
	it("renders node-usage_limit with limit line text", async () => {
		await act(async () =>
			root.render(
				<LimitNode
					event={{
						kind: "usage_limit",
						agent: "Codex",
					}}
				/>,
			),
		);
		const node = container.querySelector('[data-testid="node-usage_limit"]');
		expect(node?.textContent).toBe("Codex reached its usage limit");
	});
});
