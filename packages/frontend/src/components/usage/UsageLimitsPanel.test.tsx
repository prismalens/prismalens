// @vitest-environment happy-dom
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { UsageLimits } from "@prismalens/contracts";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AgentLimitsRow, UsageLimitsPanel } from "./UsageLimitsPanel";

const readLimits = vi.hoisted(() =>
	vi.fn(async (input: { agent: string }) => ({
		agent: input.agent,
		windows: [],
	})),
);

vi.mock("@/lib/api/orpc-client", () => ({
	orpc: {
		usage: {
			limits: {
				key: () => ["usage", "limits"],
				queryOptions: () => ({
					queryKey: ["usage", "limits"],
					queryFn: async () => served,
				}),
			},
			readLimits: {
				mutationOptions: () => ({ mutationFn: readLimits }),
			},
		},
	},
}));

let served: UsageLimits = { agents: [] };
const NOW = new Date("2026-11-26T12:00:00.000Z").getTime();
const ago = (min: number) => new Date(NOW - min * 60_000).toISOString();

let container: HTMLDivElement;
let root: Root;
let client: QueryClient;

beforeEach(() => {
	vi.useFakeTimers({ toFake: ["Date"] });
	vi.setSystemTime(NOW);
	readLimits.mockClear();
	client = new QueryClient();
	container = document.createElement("div");
	document.body.appendChild(container);
	root = createRoot(container);
});

afterEach(() => {
	act(() => root.unmount());
	container.remove();
	vi.useRealTimers();
});

const render = async (limits: UsageLimits, readOnOpen = false) => {
	await act(async () => {
		root.render(
			<QueryClientProvider client={client}>
				<UsageLimitsPanel limits={limits} now={NOW} readOnOpen={readOnOpen} />
			</QueryClientProvider>,
		);
	});
};

const text = (id: string) =>
	container.querySelector(`[data-testid="${id}"]`)?.textContent;

describe("UsageLimitsPanel empty agents (#1171)", () => {
	it("says an agent shows after a run, or that it does not report", async () => {
		await render({
			agents: [
				{ agent: "claude-code", windows: [], empty: "no-run-yet" },
				{ agent: "opencode", windows: [], empty: "not-reported" },
			],
		});
		expect(text("limits-empty-claude-code")).toBe("Shows after a run");
		expect(text("limits-empty-opencode")).toBe("Not reported");
	});
});

describe("UsageLimitsPanel limit reads on open (#1180)", () => {
	it("reads once an agent whose newest read is over 5 minutes old, never a fresh one or one without a read", async () => {
		const limits: UsageLimits = {
			agents: [
				{
					agent: "claude-code",
					windows: [],
					empty: "no-run-yet",
					checkedAt: ago(6),
				},
				{
					agent: "codex",
					windows: [],
					empty: "no-run-yet",
					checkedAt: ago(10),
					triedAt: ago(2),
				},
				{ agent: "opencode", windows: [], empty: "not-reported" },
			],
		};
		await render(limits, true);
		await render({ agents: [...limits.agents] }, true);
		expect(readLimits.mock.calls.map((c) => c[0])).toEqual([
			{ agent: "claude-code" },
		]);
	});

	it("reads an agent that has never been read", async () => {
		await render(
			{ agents: [{ agent: "codex", windows: [], empty: "no-run-yet" }] },
			true,
		);
		expect(readLimits.mock.calls.map((c) => c[0])).toEqual([
			{ agent: "codex" },
		]);
	});

	it("starts no read when the panel is not asked to", async () => {
		await render({
			agents: [{ agent: "codex", windows: [], empty: "no-run-yet" }],
		});
		expect(readLimits).not.toHaveBeenCalled();
	});

	it("shows the shown read's Checked time and a later failed try", async () => {
		await render({
			agents: [
				{
					agent: "claude-code",
					windows: [],
					empty: "no-run-yet",
					checkedAt: ago(3),
					triedAt: ago(1),
				},
			],
		});
		expect(text("limits-checked-claude-code")).toBe("Checked 3m ago");
		expect(text("limits-tried-claude-code")).toBe("Last try failed 1m ago");
	});
});

describe("AgentLimitsRow (#1180)", () => {
	it("shows the agent's Checked time and reads it again when its read is old", async () => {
		served = {
			agents: [
				{
					agent: "codex",
					windows: [],
					empty: "no-run-yet",
					checkedAt: ago(7),
				},
			],
		};
		await act(async () => {
			root.render(
				<QueryClientProvider client={client}>
					<AgentLimitsRow agent="codex" />
				</QueryClientProvider>,
			);
		});
		await vi.waitFor(() => {
			if (!text("limits-checked-codex")) throw new Error("limits not loaded");
		});
		expect(text("limits-checked-codex")).toBe("Checked 7m ago");
		expect(readLimits.mock.calls.map((c) => c[0])).toEqual([
			{ agent: "codex" },
		]);
	});
});
