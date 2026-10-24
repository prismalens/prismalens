// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel
// @vitest-environment happy-dom

import type { CanonicalEvent } from "@prismalens/contracts";
import { act, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { overviewSteps, RunOverview } from "./RunDetailsPanel";
import { RunStrip } from "./RunStrip";
import {
	codeLine,
	runsFolder,
	skippedWord,
	toolsStatus,
	toolsWord,
	toolTurns,
	turnLine,
} from "./RunTools";

vi.mock("@/components/run/EvidenceFileView", () => ({
	EvidenceFileView: () => null,
}));

vi.mock("@/components/shared/Hint", () => ({
	Hint: ({ children }: { children: ReactNode }) => children,
}));

describe("runsFolder and codeLine (#848)", () => {
	it("finds the runs folder on posix and windows paths", () => {
		expect(runsFolder("/home/u/.prismalens/runs/abc/repo")).toBe(
			"/home/u/.prismalens/runs",
		);
		expect(runsFolder("C:\\Users\\u\\.prismalens\\runs\\abc\\repo")).toBe(
			"C:\\Users\\u\\.prismalens\\runs",
		);
		expect(runsFolder("/other/path")).toBeNull();
		expect(runsFolder(null)).toBeNull();
	});

	it("formats codeLine for empty, single, and skipped repositories", () => {
		expect(codeLine(null, [])).toBe("Ran without code");
		expect(codeLine({ repos: [] }, [])).toBe("Ran without code");
		expect(codeLine({ repos: [{ name: "booklogr" }] as never }, [])).toBe(
			"booklogr",
		);
		expect(codeLine({ repos: [] }, [{ repo: "api", code: "budget" }])).toBe(
			"None, 1 skipped",
		);
		const repos = Array.from({ length: 7 }, (_, i) => ({
			name: `r${i}`,
		})) as never;
		expect(codeLine({ repos }, [{ repo: "r8", code: "budget" }])).toBe(
			"8 repositories, 1 skipped",
		);
	});

	it("translates checkout skipped reasons", () => {
		expect(skippedWord({ code: "budget" })).toBe(
			"Skipped: the time for checkouts ran out",
		);
		expect(skippedWord({ code: "failed" })).toBe("Not checked out");
		expect(skippedWord({ code: "guard" })).toBe(
			"Skipped: over the 32-repository guard",
		);
	});
});

describe("toolTurns, toolsStatus, and toolsWord (#848)", () => {
	it("detects mid-turn reload with live harness_tool_call events", () => {
		const events: CanonicalEvent[] = [
			{
				kind: "harness_tool_call",
				turn: "first",
				name: "read_file",
				at: "2026-10-10T12:04:31Z",
			} as never,
			{
				kind: "harness_tool_call",
				turn: "first",
				name: "read_file",
				at: "2026-10-10T12:05:00Z",
			} as never,
		];
		const turns = toolTurns(events);
		expect(turns).toHaveLength(1);
		expect(turns[0]?.total).toBe(2);
		expect(turns[0]?.firstAt).toBe("2026-10-10T12:04:31Z");

		const status = toolsStatus(turns, {
			loading: false,
			error: false,
			live: true,
		});
		expect(status.state).toBe("reached");
		expect(toolsWord(status)).toMatch(
			/^Reached the model \(first call \d{2}:\d{2}:\d{2}\)$/,
		);
		const first = turns[0];
		if (first) {
			expect(turnLine(first)).toMatch(/^2 calls, first at \d{2}:\d{2}:\d{2}$/);
		}
	});

	it("distinguishes connected, not-reached, loading, error, and waiting states", () => {
		const connectedTurn = toolTurns([
			{
				kind: "harness_tools",
				turn: "first",
				connected: true,
				calls: [],
			} as never,
		]);
		const connectedStatus = toolsStatus(connectedTurn, {
			loading: false,
			error: false,
			live: true,
		});
		expect(connectedStatus.state).toBe("connected");
		expect(toolsWord(connectedStatus)).toBe("Connected, not yet called");

		const notReachedTurn = toolTurns([
			{
				kind: "harness_tools",
				turn: "first",
				connected: false,
				calls: [],
			} as never,
		]);
		const notReachedStatus = toolsStatus(notReachedTurn, {
			loading: false,
			error: false,
			live: true,
		});
		expect(notReachedStatus.state).toBe("not-reached");
		expect(toolsWord(notReachedStatus)).toBe("Did not reach the model");

		expect(
			toolsWord(toolsStatus([], { loading: true, error: false, live: true })),
		).toBe("Loading");
		expect(
			toolsWord(toolsStatus([], { loading: false, error: true, live: true })),
		).toBe("Did not load");
		expect(
			toolsWord(toolsStatus([], { loading: false, error: false, live: true })),
		).toBe("Not called yet");
		expect(
			toolsWord(toolsStatus([], { loading: false, error: false, live: false })),
		).toBe("Not recorded for this run");
	});

	it("merges summary and live counts taking the maximum, and includes follow-up turn only if present", () => {
		const events: CanonicalEvent[] = [
			{
				kind: "harness_tool_call",
				turn: "first",
				name: "search",
				at: "2026-10-10T12:00:00Z",
			} as never,
			{
				kind: "harness_tool_call",
				turn: "first",
				name: "search",
				at: "2026-10-10T12:01:00Z",
			} as never,
			{
				kind: "harness_tool_call",
				turn: "first",
				name: "search",
				at: "2026-10-10T12:02:00Z",
			} as never,
			{
				kind: "harness_tools",
				turn: "first",
				connected: true,
				calls: [
					{
						name: "search",
						count: 2,
						firstCalledAt: "2026-10-10T12:00:00Z",
					},
				],
			} as never,
		];
		const turns = toolTurns(events);
		expect(turns).toHaveLength(1);
		expect(turns[0]?.calls[0]?.count).toBe(3);

		const withFollowUp = toolTurns([
			...events,
			{
				kind: "harness_tool_call",
				turn: "follow-up",
				name: "read_file",
				at: "2026-10-10T12:10:00Z",
			} as never,
		]);
		expect(withFollowUp).toHaveLength(2);
		expect(withFollowUp[1]?.turn).toBe("follow-up");
	});
});

describe("overviewSteps and RunOverview component (#848)", () => {
	let container: HTMLDivElement | null = null;
	let root: ReturnType<typeof createRoot> | null = null;

	beforeEach(() => {
		container = document.createElement("div");
		document.body.appendChild(container);
		root = createRoot(container);
	});

	afterEach(() => {
		if (container) {
			act(() => root?.unmount());
			container.remove();
			container = null;
			root = null;
		}
	});

	it("maps each ToolsStatus to the right overview step labels and tones", () => {
		const reached = overviewSteps({
			snapshot: "Saved",
			code: "1 repo",
			agent: "Claude",
			status: { state: "reached", firstAt: "2026-10-10T12:00:00Z" },
		});
		expect(reached.find((s) => s.name === "Tools")).toMatchObject({
			text: "Connected",
			tone: "ok",
		});
		expect(reached.find((s) => s.name === "Model")).toMatchObject({
			text: "Used a tool",
			tone: "ok",
		});

		const notReached = overviewSteps({
			snapshot: "Saved",
			code: "1 repo",
			agent: "Claude",
			status: { state: "not-reached" },
		});
		expect(notReached.find((s) => s.name === "Tools")).toMatchObject({
			text: "Not connected",
			tone: "warn",
		});
		expect(notReached.find((s) => s.name === "Model")).toMatchObject({
			text: "Did not get them",
			tone: "warn",
		});
	});

	it("renders RunOverview with hint command-chip when tools did not reach", async () => {
		const turns = toolTurns([
			{
				kind: "harness_tools",
				turn: "first",
				connected: false,
				calls: [],
			} as never,
		]);
		const status = toolsStatus(turns, {
			loading: false,
			error: false,
			live: false,
		});
		const steps = overviewSteps({
			snapshot: "Saved",
			code: "1 repo",
			agent: "Gemini",
			status,
		});

		await act(async () => {
			root?.render(
				<RunOverview
					steps={steps}
					status={status}
					turns={turns}
					hint={{
						text: "Gemini requires folder trust",
						folder: "/home/u/.prismalens/runs",
					}}
				/>,
			);
		});

		const statusEl = container?.querySelector(
			'[data-testid="run-tools-status"]',
		);
		expect(statusEl?.textContent).toBe("Did not reach the model");

		const hintEl = container?.querySelector('[data-testid="run-tools-hint"]');
		expect(hintEl).not.toBeNull();
		const chipEl = container?.querySelector('[data-testid="command-chip"]');
		expect(chipEl?.textContent).toContain("/home/u/.prismalens/runs");
	});

	it("renders RunStrip showing run-strip-tools only when tools chip is provided", async () => {
		await act(async () => {
			root?.render(
				<RunStrip
					state="running"
					label="Run 1"
					detail="Investigating"
					incidentId="inc-1"
					runs={[]}
					current="run-1"
					tools={{
						text: "Tools: not connected",
						title: "Did not reach the model",
						warn: true,
					}}
				/>,
			);
		});
		expect(
			container?.querySelector('[data-testid="run-strip-tools"]'),
		).not.toBeNull();

		await act(async () => {
			root?.render(
				<RunStrip
					state="running"
					label="Run 1"
					detail="Investigating"
					incidentId="inc-1"
					runs={[]}
					current="run-1"
					tools={null}
				/>,
			);
		});
		expect(
			container?.querySelector('[data-testid="run-strip-tools"]'),
		).toBeNull();
	});
});
