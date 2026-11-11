// @vitest-environment happy-dom
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { CanonicalEvent } from "@prismalens/contracts";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { appNodes } from "@/components/investigation/transcript/nodes.app";

(
	globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const compactMutate = vi.fn();
const useCompactSessionMock = vi.fn((_id: string) => ({
	mutate: compactMutate,
	isPending: false,
}));

vi.mock("@/lib/api/hooks/use-session-orpc", () => ({
	useCompactSession: (id: string) => useCompactSessionMock(id),
}));

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
	container = document.createElement("div");
	document.body.appendChild(container);
	root = createRoot(container);
	compactMutate.mockClear();
	useCompactSessionMock.mockClear();
});

afterEach(async () => {
	await act(async () => root.unmount());
	container.remove();
});

const base = {
	runId: "00000000-0000-0000-0000-000000000001",
	branchId: "branch-1",
	path: [],
	seq: 1,
	ts: "2026-11-11T15:00:00.000Z",
};

describe("SessionTranscriptNodes", () => {
	it("appNodes keys match compaction, resume_scheduled, resumed, and usage_limit", () => {
		const expected = [
			"compaction",
			"resume_scheduled",
			"resumed",
			"usage_limit",
		].sort();
		expect(Object.keys(appNodes).sort()).toEqual(expected);
	});

	it("rendering appNodes.compaction.Node with failed compaction shows Compaction failed and clicking Retry calls mutate with keep notes", async () => {
		const CompactionNode = appNodes.compaction?.Node;
		if (!CompactionNode) {
			throw new Error("Compaction node not found in appNodes");
		}
		const event: CanonicalEvent = {
			kind: "compaction",
			phase: "failed",
			method: "summary",
			instructions: "keep notes",
			...base,
		};
		await act(async () => {
			root.render(
				<CompactionNode event={event} runId="r1" incidentId={null} />,
			);
		});
		expect(container.textContent).toContain("Compaction failed");
		expect(useCompactSessionMock).toHaveBeenCalledWith("r1");

		const retryBtn = container.querySelector(
			'[data-testid="node-compaction-retry"]',
		) as HTMLButtonElement;
		await act(async () => {
			retryBtn.click();
		});
		expect(compactMutate).toHaveBeenCalledTimes(1);
		expect(compactMutate).toHaveBeenCalledWith("keep notes");
	});

	it("rendering appNodes.usage_limit.Node shows agent reached its usage limit", async () => {
		const LimitNode = appNodes.usage_limit?.Node;
		if (!LimitNode) {
			throw new Error("Usage limit node not found in appNodes");
		}
		const event: CanonicalEvent = {
			kind: "usage_limit",
			agent: "Codex",
			text: "limit",
			resetsAt: null,
			...base,
		};
		await act(async () => {
			root.render(<LimitNode event={event} runId="r1" incidentId={null} />);
		});
		expect(container.textContent).toContain("Codex reached its usage limit");
	});
});
