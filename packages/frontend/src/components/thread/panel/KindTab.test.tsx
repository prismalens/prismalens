// @vitest-environment happy-dom
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { ThreadContext } from "@prismalens/contracts";
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { KindTab, recurrenceLine } from "./KindTab";

vi.mock("@tanstack/react-router", () => ({
	Link: ({ children }: { children: ReactNode }) => children,
}));

vi.mock("@/components/terminal/RunInTerminal", () => ({
	RunInTerminal: ({ command }: { command: string }) => (
		<span data-testid="run-terminal">{command}</span>
	),
}));

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

const baseContext = {
	threadId: "th-1",
	title: "Thread",
	machine: { hostName: "host-1", os: "linux" as const, isHost: true },
	agent: { harness: "agent", model: "model-1", effort: null },
	workspace: null,
	lineage: [],
	plan: null,
	pullRequests: [],
};

describe("recurrenceLine (#1024)", () => {
	it.each([
		[
			{ type: "cron" as const, expr: "0 9 * * 1-5", timezone: "UTC" },
			"0 9 * * 1-5 (UTC)",
		],
		[
			{
				type: "interval" as const,
				everyMinutes: 60,
				anchorAt: "2026-11-10T00:00:00.000Z",
			},
			"Every hour",
		],
		[
			{
				type: "interval" as const,
				everyMinutes: 1440,
				anchorAt: "2026-11-10T00:00:00.000Z",
			},
			"Every day",
		],
		[
			{
				type: "interval" as const,
				everyMinutes: 90,
				anchorAt: "2026-11-10T00:00:00.000Z",
			},
			"Every 90 minutes",
		],
		[null, "Runs only when started"],
	])("recurrenceLine for %j returns %s", (recurrence, expected) => {
		expect(recurrenceLine(recurrence)).toBe(expected);
	});
});

describe("KindTab (#1024)", () => {
	it("renders kind-tab-incident with INC-7 CheckoutLatencyHigh, a suspect statement, and its status word", async () => {
		const context: ThreadContext = {
			...baseContext,
			kind: "incident",
			incident: {
				id: "inc-7",
				number: 7,
				title: "CheckoutLatencyHigh",
				severity: "high",
				status: "investigating",
				alertCount: 2,
				impact: null,
			},
			suspects: [
				{
					id: "s1",
					statement: "Database connection pool exhausted",
					status: "supported",
				},
			],
			report: "ready",
		};

		await act(async () => {
			root.render(<KindTab context={context} />);
		});

		const el = container.querySelector('[data-testid="kind-tab-incident"]');
		expect(el).not.toBeNull();
		expect(container.textContent).toContain("INC-7 CheckoutLatencyHigh");
		const suspect = container.querySelector('[data-testid="suspect"]');
		expect(suspect?.textContent).toBe(
			"SupportedDatabase connection pool exhausted",
		);
	});

	it("renders kind-tab-schedule with recurrence line and last runs", async () => {
		const context: ThreadContext = {
			...baseContext,
			kind: "schedule",
			schedule: {
				id: "sch-1",
				name: "Morning check",
				recurrence: {
					type: "cron",
					expr: "0 9 * * 1-5",
					timezone: "UTC",
				},
				nextRunAt: null,
				lastRuns: [],
			},
		};

		await act(async () => {
			root.render(<KindTab context={context} />);
		});

		const el = container.querySelector('[data-testid="kind-tab-schedule"]');
		expect(el).not.toBeNull();
		expect(container.textContent).toContain("0 9 * * 1-5 (UTC)");
	});

	it("renders kind-tab-service with service owner and a dependency", async () => {
		const context: ThreadContext = {
			...baseContext,
			kind: "service",
			service: {
				id: "srv-1",
				name: "Billing Service",
				tier: "tier-1",
				owner: "Payment Platform",
				dependencies: [{ id: "dep-1", name: "auth-service" }],
			},
		};

		await act(async () => {
			root.render(<KindTab context={context} />);
		});

		const el = container.querySelector('[data-testid="kind-tab-service"]');
		expect(el).not.toBeNull();
		expect(container.textContent).toContain("Payment Platform");
		expect(container.textContent).toContain("auth-service");
	});

	it("renders kind-tab-project with a script command", async () => {
		const context: ThreadContext = {
			...baseContext,
			kind: "project",
			project: {
				id: "proj-1",
				name: "Webapp",
			},
			scripts: [{ runner: "pnpm", name: "build", command: "pnpm build" }],
		};

		await act(async () => {
			root.render(<KindTab context={context} />);
		});

		const el = container.querySelector('[data-testid="kind-tab-project"]');
		expect(el).not.toBeNull();
		expect(container.textContent).toContain("pnpm build");
	});

	it("renders nothing when context kind is none", async () => {
		const context: ThreadContext = {
			...baseContext,
			kind: "none",
			helperPlace: null,
		};

		await act(async () => {
			root.render(<KindTab context={context} />);
		});

		expect(container.innerHTML).toBe("");
	});
});
