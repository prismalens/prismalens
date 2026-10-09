// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { HarnessStatus } from "@prismalens/contracts";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import {
	chipModel,
	defaultModelLine,
	EffortChip,
	effortLevels,
	ModeChip,
	modelName,
	unreadyReason,
} from "./AgentPicker";

vi.mock("@/components/ui/popover", () => ({
	Popover: ({ children }: { children: React.ReactNode }) => children,
	PopoverTrigger: ({ children }: { children: React.ReactNode }) => children,
	PopoverContent: ({ children }: { children: React.ReactNode }) => children,
}));
vi.mock("@/components/shared/Hint", () => ({
	Hint: ({ label, children }: { label: string; children: React.ReactNode }) =>
		React.createElement("span", { "data-hint": label }, children),
}));
vi.mock("@/lib/api/hooks", () => ({
	useHarnesses: () => ({ data: { harnesses: [] }, isLoading: false }),
	useHarnessSettings: () => ({ data: { agentModes: {} }, isLoading: false }),
	useUpdateHarnessSettings: () => ({ mutate: vi.fn() }),
	useCheckHarness: () => ({ mutate: vi.fn(), isPending: false }),
}));

const claude = (over: Partial<HarnessStatus> = {}): HarnessStatus => ({
	id: "claude-code",
	label: "Claude Code",
	binary: "claude",
	installed: true,
	tested: null,
	install: "",
	defaultModel: null,
	defaultMode: "default",
	modelVia: "acp",
	loginHint: "",
	envModel: null,
	windowsOnlyPath: null,
	models: {
		source: "harness",
		asOf: "",
		entries: [{ id: "claude-sonnet-5-5", name: "Sonnet 5.5", status: null }],
	},
	checked: {
		at: "",
		outcome: "answers-acp",
		detail: "answers ACP",
		servedModel: "claude-sonnet-5-5",
		effort: null,
		modes: [
			{ id: "default", name: "Manual", description: "Always ask before making changes" },
			{ id: "bypassPermissions", name: "Bypass permissions", description: "Accepts all permissions" },
		],
		efforts: [
			{ id: "default", name: "Default", default: false },
			{ id: "high", name: "High", default: true },
		],
		images: true,
		sandbox: null,
	},
	...over,
});

describe("the box's chips (#673)", () => {
	it("names the resolved model on Agent default, never a bare Agent default", () => {
		expect(chipModel(claude(), "")).toBe("Sonnet 5.5");
		expect(chipModel(claude({ checked: null }), "")).toBe("Claude Code default");
	});

	it("greys an installed agent whose check did not answer, with its reason", () => {
		const codex = claude({
			id: "codex",
			label: "Codex",
			checked: {
				...(claude().checked as NonNullable<HarnessStatus["checked"]>),
				outcome: "sign-in-needed",
				detail: "sign in needed",
			},
		});
		expect(unreadyReason(codex)).toBe("Codex: sign in needed");
		expect(unreadyReason(claude())).toBeNull();
	});

	it("reads the level and the window as two spans, and stays disabled with its reason without levels", () => {
		const on = renderToStaticMarkup(
			React.createElement(EffortChip, {
				harness: claude(),
				model: "claude-sonnet-5-5",
				effort: null,
				onEffort: () => {},
				onModel: () => {},
			}),
		);
		expect(on).toContain("<span>High</span>");
		expect(on).toContain("200k");
		expect(effortLevels(claude({ checked: null }))).toEqual([]);
		const off = renderToStaticMarkup(
			React.createElement(EffortChip, {
				harness: claude({ checked: null }),
				model: "gemma4:31b-cloud",
				effort: null,
				onEffort: () => {},
				onModel: () => {},
			}),
		);
		expect(off).toContain(
			"gemma4:31b-cloud has no effort levels; the context window is fixed by the model",
		);
		expect(off).toContain("disabled");
	});

	it("lists the agent's own modes, its default first and tagged, with the yes clause where the agent asks", () => {
		const html = renderToStaticMarkup(
			React.createElement(ModeChip, {
				harness: claude(),
				mode: "default",
				onMode: () => {},
			}),
		);
		expect(html.indexOf("Manual")).toBeLessThan(html.indexOf("Bypass permissions"));
		expect(html).toContain("Your default");
		expect(html).toContain(
			"Always ask before making changes. PrismaLens answers yes and logs it.",
		);
		// claude-agent-acp still asks on bypass-immune safety checks, so bypass carries the clause too (#799).
		expect(html).toContain(
			"Accepts all permissions. PrismaLens answers yes and logs it.",
		);
	});
});

describe("defaultModelLine (#673 w57)", () => {
	it("returns '<model>, from your environment' when envModel is set", () => {
		expect(
			defaultModelLine(
				claude({
					envModel: { key: "CLAUDE_MODEL", model: "claude-sonnet-5-5" },
				}),
			),
		).toBe("Sonnet 5.5, from your environment");
	});

	it("returns the servedModel name when only servedModel is set", () => {
		expect(defaultModelLine(claude({ envModel: null }))).toBe("Sonnet 5.5");
	});

	it("returns undefined when neither envModel nor servedModel is set", () => {
		expect(
			defaultModelLine(claude({ envModel: null, checked: null })),
		).toBeUndefined();
	});
});

describe("modelName (#673)", () => {
	const opencode = (over: Partial<HarnessStatus> = {}): HarnessStatus =>
		claude({
			id: "opencode",
			label: "OpenCode",
			models: {
				source: "harness",
				asOf: "",
				entries: [
					{
						id: "opencode/muse-spark-1.3-free",
						name: "OpenCode Zen/Muse Spark 1.3 Free",
						status: null,
					},
					{
						id: "anthropic/claude-x",
						name: "Anthropic/Claude X",
						status: null,
					},
				],
			},
			...over,
		});

	it("resolves model names stripped of provider prefix, by id and by lenient match", () => {
		const harness = opencode();
		expect(modelName(harness, "opencode/muse-spark-1.3-free")).toBe(
			"Muse Spark 1.3 Free",
		);
		expect(modelName(harness, "Muse Spark 1.3 (free)")).toBe(
			"Muse Spark 1.3 Free",
		);
		expect(modelName(harness, "unknown-model-id")).toBe("unknown-model-id");
		expect(modelName(harness, null)).toBeNull();
		expect(chipModel(harness, "Muse Spark 1.3 (free)")).toBe(
			"Muse Spark 1.3 Free",
		);
		const nonProvider = opencode({
			models: {
				source: "harness",
				asOf: "",
				entries: [
					{
						id: "opencode/foo",
						name: "Zen/Foo",
						status: null,
					},
				],
			},
		});
		expect(modelName(nonProvider, "opencode/foo")).toBe("Zen/Foo");
	});
});
