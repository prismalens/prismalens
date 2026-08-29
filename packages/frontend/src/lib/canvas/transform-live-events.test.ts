// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { AGENT_IDS } from "@prismalens/config/agents";
import type { CanonicalEvent } from "@prismalens/contracts";
import { describe, expect, it } from "vitest";
import {
	AGENT_PALETTES,
	getAgentMiniMapColor,
	getAgentPalette,
	getAgentStyle,
	transformLiveEventsToCanvas,
} from "./transform-live-events";

describe("transformLiveEventsToCanvas", () => {
	it("returns empty nodes and edges for empty events array", () => {
		const result = transformLiveEventsToCanvas([], "running");
		expect(result).toEqual({ nodes: [], edges: [] });

		const completedResult = transformLiveEventsToCanvas([], "completed");
		expect(completedResult).toEqual({ nodes: [], edges: [] });
	});

	it("creates agent node with running status and START node for first agent_step", () => {
		const events: CanonicalEvent[] = [
			{
				kind: "agent_step",
				runId: "00000000-0000-0000-0000-000000000001",
				branchId: "b1",
				path: [],
				seq: 1,
				label: "scout",
				text: "Starting scout",
				toolCalls: [],
				ts: "2026-08-04T00:00:00Z",
			},
		];

		const { nodes, edges } = transformLiveEventsToCanvas(events, "running");

		expect(nodes).toHaveLength(2); // START + scout
		expect(nodes[0]?.id).toBe("start");
		expect(nodes[1]?.id).toBe("live:b1:scout");
		expect(nodes[1]?.data.status).toBe("running");
		expect(nodes[1]?.data.label).toBe("Scout");
		expect(nodes[1]?.data.toolCount).toBe(0);

		expect(edges).toHaveLength(1);
		expect(edges[0]?.source).toBe("start");
		expect(edges[0]?.target).toBe("live:b1:scout");
		expect(edges[0]?.animated).toBe(true);
	});

	it("increments toolCount on tool_result and ignores tool_result with unknown branchId", () => {
		const events: CanonicalEvent[] = [
			// tool_result with unknown branchId before any agent_step - should be ignored
			{
				kind: "tool_result",
				runId: "00000000-0000-0000-0000-000000000001",
				branchId: "unknown_b",
				path: [],
				seq: 0,
				result: {
					name: "query",
					toolCallId: "tc0",
					source: "query",
					ok: true,
					preview: "res",
				},
				ts: "2026-08-04T00:00:00Z",
			},
			{
				kind: "agent_step",
				runId: "00000000-0000-0000-0000-000000000001",
				branchId: "b1",
				path: [],
				seq: 1,
				label: "analyst",
				text: "Investigating",
				toolCalls: [],
				ts: "2026-08-04T00:00:01Z",
			},
			{
				kind: "tool_result",
				runId: "00000000-0000-0000-0000-000000000001",
				branchId: "b1",
				path: [],
				seq: 2,
				result: {
					name: "fetch_logs",
					toolCallId: "tc1",
					source: "fetch_logs",
					ok: true,
					preview: "log output",
				},
				ts: "2026-08-04T00:00:02Z",
			},
		];

		const { nodes } = transformLiveEventsToCanvas(events, "running");

		expect(nodes).toHaveLength(2); // START + analyst
		expect(nodes[1]?.id).toBe("live:b1:analyst");
		expect(nodes[1]?.data.toolCount).toBe(1);
	});

	it("flips node status to completed on branch_done and stops edge animation", () => {
		const events: CanonicalEvent[] = [
			{
				kind: "agent_step",
				runId: "00000000-0000-0000-0000-000000000001",
				branchId: "b1",
				path: [],
				seq: 1,
				label: "resolver",
				text: "Executing repair",
				toolCalls: [],
				ts: "2026-08-04T00:00:00Z",
			},
			{
				kind: "branch_done",
				runId: "00000000-0000-0000-0000-000000000001",
				branchId: "b1",
				path: [],
				seq: 2,
				reason: "submitted",
				ts: "2026-08-04T00:00:01Z",
			},
		];

		const { nodes, edges } = transformLiveEventsToCanvas(events, "running");

		expect(nodes[1]?.data.status).toBe("completed");
		expect(edges[0]?.animated).toBe(false);
	});

	it("flips node status to failed on error and records error message", () => {
		const events: CanonicalEvent[] = [
			{
				kind: "agent_step",
				runId: "00000000-0000-0000-0000-000000000001",
				branchId: "b1",
				path: [],
				seq: 1,
				label: "analyst",
				text: "Analyzing",
				toolCalls: [],
				ts: "2026-08-04T00:00:00Z",
			},
			{
				kind: "error",
				runId: "00000000-0000-0000-0000-000000000001",
				branchId: "b1",
				path: [],
				seq: 2,
				message: "Connection timeout to DB",
				ts: "2026-08-04T00:00:01Z",
			},
		];

		const { nodes } = transformLiveEventsToCanvas(events, "running");

		expect(nodes[1]?.data.status).toBe("failed");
		expect(nodes[1]?.data.error).toBe("Connection timeout to DB");
	});

	it("maintains insertion order regardless of ts timestamp order (ruling 2 stability)", () => {
		// Ordering stability is insertion-based per ruling 2 (no reflow physics / re-sorting mid-run),
		// so nodes stay in the exact order events arrive.
		const events: CanonicalEvent[] = [
			{
				kind: "agent_step",
				runId: "00000000-0000-0000-0000-000000000001",
				branchId: "b1",
				path: [],
				seq: 1,
				label: "first_agent",
				text: "First",
				toolCalls: [],
				ts: "2026-08-04T00:00:10Z",
			},
			{
				kind: "agent_step",
				runId: "00000000-0000-0000-0000-000000000001",
				branchId: "b2",
				path: [],
				seq: 1,
				label: "second_agent",
				text: "Second",
				toolCalls: [],
				ts: "2026-08-04T00:00:01Z",
			},
		];

		const { nodes } = transformLiveEventsToCanvas(events, "running");

		expect(nodes[1]?.id).toBe("live:b1:first_agent");
		expect(nodes[2]?.id).toBe("live:b2:second_agent");
	});

	it("appends END node on terminal investigationStatus", () => {
		const events: CanonicalEvent[] = [
			{
				kind: "agent_step",
				runId: "00000000-0000-0000-0000-000000000001",
				branchId: "b1",
				path: [],
				seq: 1,
				label: "analyst",
				text: "Step",
				toolCalls: [],
				ts: "2026-08-04T00:00:00Z",
			},
		];

		const completed = transformLiveEventsToCanvas(events, "completed");
		expect(completed.nodes).toHaveLength(3); // START + analyst + END
		expect(completed.nodes[2]?.id).toBe("end");
		expect(completed.nodes[2]?.data.label).toBe("END");
		expect(completed.nodes[2]?.data.status).toBe("completed");
		expect(completed.edges[1]?.target).toBe("end");
		expect(completed.edges[1]?.animated).toBe(false);

		const failed = transformLiveEventsToCanvas(events, "failed");
		expect(failed.nodes[2]?.data.label).toBe("FAILED");
		expect(failed.nodes[2]?.data.status).toBe("failed");
	});
});

describe("getAgentMiniMapColor", () => {
	it("returns light pastel hsl in light mode (85% lightness)", () => {
		const color = getAgentMiniMapColor("scout", "light");
		expect(color).toMatch(/^hsl\(\d+,\s*70%,\s*85%\)$/);
	});

	it("returns darkened hsl in dark mode (40% lightness)", () => {
		const color = getAgentMiniMapColor("scout", "dark");
		expect(color).toMatch(/^hsl\(\d+,\s*50%,\s*40%\)$/);
	});

	it("defaults to light theme when theme is omitted", () => {
		const color = getAgentMiniMapColor("scout");
		expect(color).toMatch(/^hsl\(\d+,\s*70%,\s*85%\)$/);
	});
});

describe("getAgentStyle and AGENT_PALETTES (#408)", () => {
	it("defines statically-written class strings across all palette buckets", () => {
		expect(AGENT_PALETTES.length).toBeGreaterThanOrEqual(6);
		for (const palette of AGENT_PALETTES) {
			expect(palette.bg).toMatch(/^bg-[a-z]+-50 dark:bg-[a-z]+-950/);
			expect(palette.border).toMatch(/^border-[a-z]+-200 dark:border-[a-z]+-800/);
			expect(palette.textColor).toMatch(/^text-[a-z]+-900 dark:text-[a-z]+-100/);
			expect(palette.iconColor).toMatch(/^text-[a-z]+-600 dark:text-[a-z]+-400/);
		}
	});

	it("returns deterministic styling for known registered agents", () => {
		const scoutStyle1 = getAgentStyle("scout");
		const scoutStyle2 = getAgentStyle("scout");

		expect(scoutStyle1).toEqual(scoutStyle2);
		expect(scoutStyle1.displayName).toBe("Scout");
		expect(scoutStyle1.bg).toContain("bg-");
		expect(scoutStyle1.border).toContain("border-");
		expect(scoutStyle1.textColor).toContain("text-");
		expect(scoutStyle1.iconColor).toContain("text-");
	});

	it("formats unregistered agent names and falls back gracefully", () => {
		const style = getAgentStyle("custom_pipeline_worker");
		expect(style.displayName).toBe("Custom Pipeline Worker");
		expect(style.bg).toContain("bg-");
		expect(style.border).toContain("border-");
		expect(style.textColor).toContain("text-");
		expect(style.iconColor).toContain("text-");
	});

	it("derives MiniMap colour and canvas palette entry from the same bucket", () => {
		const agentNames = [
			"scout",
			"analyst",
			"resolver",
			"custom_pipeline_worker",
			"arbitrary_agent_123",
		];

		for (const agentName of agentNames) {
			const palette = getAgentPalette(agentName);
			const style = getAgentStyle(agentName);
			const lightMiniMap = getAgentMiniMapColor(agentName, "light");
			const darkMiniMap = getAgentMiniMapColor(agentName, "dark");

			expect(lightMiniMap).toBe(`hsl(${palette.hue}, 70%, 85%)`);
			expect(darkMiniMap).toBe(`hsl(${palette.hue}, 50%, 40%)`);
			expect(style.bg).toBe(palette.bg);
			expect(style.border).toBe(palette.border);
			expect(style.textColor).toBe(palette.textColor);
			expect(style.iconColor).toBe(palette.iconColor);
		}
	});

	it("assigns distinct palette entries across the registered agent roster", () => {
		const palettes = AGENT_IDS.map((id) => getAgentPalette(id));
		const uniquePalettes = new Set(palettes);
		expect(uniquePalettes.size).toBe(AGENT_IDS.length);
	});

	it("assigns distinct MiniMap colors across the registered agent roster", () => {
		const lightColors = AGENT_IDS.map((id) => getAgentMiniMapColor(id, "light"));
		const uniqueLightColors = new Set(lightColors);
		expect(uniqueLightColors.size).toBe(AGENT_IDS.length);

		const darkColors = AGENT_IDS.map((id) => getAgentMiniMapColor(id, "dark"));
		const uniqueDarkColors = new Set(darkColors);
		expect(uniqueDarkColors.size).toBe(AGENT_IDS.length);
	});

	it("resolves unrostered agent names deterministically through hash buckets", () => {
		const unregisteredName = "custom_dynamic_worker";
		const palette1 = getAgentPalette(unregisteredName);
		const palette2 = getAgentPalette(unregisteredName);
		expect(palette1).toEqual(palette2);
		expect(AGENT_PALETTES).toContain(palette1);
	});
});


