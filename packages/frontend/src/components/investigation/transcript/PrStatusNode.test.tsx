// @vitest-environment happy-dom
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { CanonicalEvent } from "@prismalens/contracts";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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

describe("PrStatusNode (#1101)", () => {
	it("renders PR #412, the tone word for the event's tone, and lines joined with ' · '", async () => {
		const event = {
			kind: "pr_status",
			runId: "run-1",
			branchId: "root",
			path: [],
			seq: 1,
			label: null,
			ts: "2026-11-12T00:00:00Z",
			prId: "pr-123",
			pr: "org/repo#412",
			tone: "failing",
			lines: ["CI failed: test", "1 open review thread"],
			phase: "noted",
		} as unknown as CanonicalEvent;

		await act(async () => {
			root.render(<PrStatusNode event={event} incidentId={null} />);
		});

		const line = container.querySelector('[data-testid="pr-status-line"]');
		expect(line?.getAttribute("data-tone")).toBe("failing");
		expect(line?.textContent).toContain("PR #412");
		expect(line?.textContent).toContain("Failing");
		expect(line?.textContent).toContain(
			"CI failed: test · 1 open review thread",
		);

		const button = container.querySelector<HTMLButtonElement>("button");
		await act(async () => {
			button?.click();
		});

		expect(navigate).toHaveBeenCalledTimes(1);
		expect(navigate).toHaveBeenCalledWith({
			to: ".",
			search: expect.any(Function),
		});
	});

	it("shows no tone word and data-tone='unknown' when event has no tone", async () => {
		const event = {
			kind: "pr_status",
			runId: "run-1",
			branchId: "root",
			path: [],
			seq: 2,
			label: null,
			ts: "2026-11-12T00:00:00Z",
			prId: "pr-123",
			pr: "org/repo#412",
			lines: ["Updated status"],
			phase: "noted",
		} as unknown as CanonicalEvent;

		await act(async () => {
			root.render(<PrStatusNode event={event} incidentId={null} />);
		});

		const line = container.querySelector('[data-testid="pr-status-line"]');
		expect(line?.getAttribute("data-tone")).toBe("unknown");
		expect(line?.textContent).toContain("PR #412");
		expect(line?.textContent).toContain("Updated status");
		expect(line?.textContent).not.toContain("Unknown");
		expect(line?.textContent).not.toContain("Failing");
		expect(line?.textContent).not.toContain("Open");
	});
});
