// @vitest-environment happy-dom
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { CanonicalEvent } from "@prismalens/contracts";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { stopNodeLine } from "@/lib/provider-stop";
import { appNodes } from "./nodes.app";
import { hasTranscriptNode, TranscriptNode } from "./registry";

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

describe("appNodes transcript registry (#1024, #1101)", () => {
	it("hasTranscriptNode is true for the six kinds in nodes.app and false for turn_usage and agent_quota", () => {
		const kinds = [
			"usage_limit",
			"provider_blocked",
			"provider_retry",
			"resume_scheduled",
			"resumed",
			"run_interrupted",
		] as const;
		for (const kind of kinds) {
			expect(hasTranscriptNode(kind, appNodes)).toBe(true);
		}
		expect(hasTranscriptNode("turn_usage", appNodes)).toBe(false);
		expect(hasTranscriptNode("agent_quota", appNodes)).toBe(false);
	});

	it("the registry draws a provider_retry event as node-provider_retry with that line", async () => {
		const event = {
			kind: "provider_retry",
			mode: "rate_limited",
			attempt: 2,
			maxAttempts: 5,
			at: "2026-11-11T15:45:00.000Z",
			runId: "00000000-0000-0000-0000-000000000001",
			branchId: "run",
			path: [],
			seq: 1,
			label: null,
			ts: "2026-11-11T15:45:00.000Z",
		} as unknown as CanonicalEvent;

		await act(async () => {
			root.render(
				<TranscriptNode event={event} incidentId={null} nodes={appNodes} />,
			);
		});

		const el = container.querySelector('[data-testid="node-provider_retry"]');
		expect(el).not.toBeNull();
		const expectedLine = stopNodeLine(event);
		expect(el?.textContent).toBe(expectedLine);
	});
});
