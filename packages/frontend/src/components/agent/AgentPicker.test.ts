// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { HarnessStatus } from "@prismalens/contracts";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import {
	agentCurrentModel,
	chipModel,
	defaultModel,
	ModelChip,
	EffortChip,
	effortLevels,
	AccessChip,
	modelName,
	unreadyLine,
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
const hooks = vi.hoisted(() => ({
	harnesses: [] as unknown[],
	settings: {} as Record<string, unknown>,
}));
vi.mock("@/lib/api/hooks", () => ({
	useHarnesses: () => ({ data: { harnesses: hooks.harnesses }, isLoading: false }),
	useHarnessSettings: () => ({ data: hooks.settings, isLoading: false }),
	useUpdateHarnessSettings: () => ({ mutate: vi.fn() }),
	useCheckHarness: () => ({ mutate: vi.fn(), isPending: false }),
}));

const claude = (over: Partial<HarnessStatus> = {}): HarnessStatus => ({
	id: "claude-code",
	label: "Claude Code",
	binary: "claude",
	installed: true,
	runnable: true,
	tested: null,
	install: "",
	defaultModel: null,
	localDefault: { permission: null },
	modelVia: "acp",
	loginHint: "",
	envModel: null,
	windowsOnlyPath: null,
	cliBinary: "",
	configDir: null,
	providerKeys: [],
	envVars: [],
	models: {
		source: "harness",
		asOf: "",
		entries: [{ id: "claude-sonnet-5-5", name: "Sonnet 5.5", status: null }],
	},
	checked: {
		at: "",
		outcome: "answers-acp",
		detail: "answers ACP",
		version: null,
		companionVersion: null,
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
	it("names a real model with none picked, never a bare default (#907)", () => {
		expect(chipModel(claude(), "")).toBe("Sonnet 5.5");
		// Nothing reports a model: the list's first entry, by its name.
		expect(chipModel(claude({ checked: null }), "")).toBe("Sonnet 5.5");
		expect(chipModel(claude({ checked: null, models: { source: "harness", asOf: "", entries: [] } }), "")).toBe(
			"Claude Code",
		);
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
		// The same words a run that fails on sign-in shows (#831 w7-3).
		expect(unreadyReason(codex)).toBe(
			"Codex is not signed in to its model provider. Sign in with its own CLI, then retry.",
		);
		expect(
			unreadyReason(
				claude({
					checked: {
						...(claude().checked as NonNullable<HarnessStatus["checked"]>),
						outcome: "no-answer",
						detail: "no answer in 10s",
					},
				}),
			),
		).toBe("Claude Code: no answer in 10s");
		expect(unreadyReason(claude())).toBeNull();
	});

	it("ends the run gate's line with one full stop per sentence (#673 w9-1)", () => {
		const codex = claude({
			id: "codex",
			label: "Codex",
			checked: {
				...(claude().checked as NonNullable<HarnessStatus["checked"]>),
				outcome: "sign-in-needed",
				detail: "sign in needed",
			},
		});
		expect(unreadyLine(codex)).toBe(
			"Codex is not signed in to its model provider. Sign in with its own CLI, then retry. Check it in Settings, Agent.",
		);
		expect(unreadyLine(claude())).toBeNull();
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
		expect(off).toContain("Fixed");
		expect(off).not.toContain("Default");
		// The agent's own effort is tagged by its name, never "Default" (#907).
		expect(on).toMatch(/Claude Code(&#x27;|')s pick/);
		expect(on).not.toMatch(/>Default</);
	});

	it("lists the four levels, the default first and tagged, each with the agent's own mode name (#673 w21)", () => {
		const html = renderToStaticMarkup(
			React.createElement(AccessChip, {
				harness: claude(),
				level: "supervised",
				onLevel: () => {},
			}),
		);
		expect(html.indexOf("Ask always")).toBeLessThan(html.indexOf("Full access"));
		expect(html).toMatch(/PrismaLens(&#x27;|')s pick/);
		expect(html).not.toContain("Default");
		expect(html).toContain("Claude Code runs in Manual.");
		expect(html).not.toContain("answers yes");
	});

	it("renders four level rows always and no mode segment, default first and tagged per from", () => {
		const html = renderToStaticMarkup(
			React.createElement(AccessChip, {
				harness: claude(),
				level: "supervised",
				onLevel: () => {},
			}),
		);
		expect(html).not.toContain("run-mode-");
		expect(html).toContain('data-testid="access-level-supervised"');
		expect(html).toContain('data-testid="access-level-auto-edits"');
		expect(html).toContain('data-testid="access-level-auto"');
		expect(html).toContain('data-testid="access-level-full-access"');
		expect(html).toMatch(/PrismaLens(&#x27;|')s pick/);
		// One line per level (#831 w6-12); the agent's mode and sandbox sit in the row's hover title.
		expect(html.match(/data-testid="access-line"/g)).toHaveLength(4);
		expect(html).not.toContain('data-testid="access-row-line"');
		expect(html).not.toContain('data-testid="access-sandbox"');
	});

	it("shows lock icon only when sandbox is enforced, and no icon otherwise", () => {
		const enforcedClaude = claude({
			checked: {
				...(claude().checked as NonNullable<HarnessStatus["checked"]>),
				sandbox: {
					default: { state: "enforced", reason: "sandbox active" },
				},
			},
		});
		const withLock = renderToStaticMarkup(
			React.createElement(AccessChip, {
				harness: enforcedClaude,
				level: "supervised",
				onLevel: () => {},
			}),
		);
		expect(withLock).toContain("lucide-lock");

		const withoutLock = renderToStaticMarkup(
			React.createElement(AccessChip, {
				harness: claude(),
				level: "supervised",
				onLevel: () => {},
			}),
		);
		expect(withoutLock).not.toContain("lucide-lock");
	});
});

describe("the model a run uses with none picked, by its real name (#907)", () => {
	const listed = {
		source: "harness" as const,
		asOf: "",
		entries: [
			{ id: "default", name: "Default (recommended)", status: null, description: "Opus 5.5" },
			{ id: "claude-sonnet-5-5", name: "Sonnet 5.5", status: null },
			{ id: "claude-opus-5-5", name: "Opus 5.5", status: null },
		],
	};
	const served = (servedModel: string | null) =>
		claude({ models: listed, checked: { ...(claude().checked as NonNullable<HarnessStatus["checked"]>), servedModel } });

	it("takes the env model, then the model the check reports", () => {
		expect(agentCurrentModel(claude({ envModel: { key: "ANTHROPIC_MODEL", model: "claude-sonnet-5-5" } }))).toEqual({
			id: "claude-sonnet-5-5",
			name: "Sonnet 5.5",
		});
		expect(agentCurrentModel(claude())).toEqual({ id: "claude-sonnet-5-5", name: "Sonnet 5.5" });
		expect(agentCurrentModel(claude({ checked: null }))).toBeNull();
	});

	it("resolves a `default` entry through the model its description names", () => {
		expect(agentCurrentModel(served("default"))).toEqual({ id: "claude-opus-5-5", name: "Opus 5.5" });
		const unlisted = claude({
			models: { ...listed, entries: [{ id: "default", name: "Default (recommended)", status: null, description: "Nova 9" }] },
			checked: { ...(claude().checked as NonNullable<HarnessStatus["checked"]>), servedModel: "default" },
		});
		expect(agentCurrentModel(unlisted)).toEqual({ id: null, name: "Nova 9" });
	});

	it("prefers the starred model, then the agent's, then the list's first; never the word Default", () => {
		expect(defaultModel(served("default"), "claude-sonnet-5-5")?.name).toBe("Sonnet 5.5");
		expect(defaultModel(served("default"), "default")?.name).toBe("Opus 5.5");
		const silent = claude({ models: { ...listed, entries: listed.entries.map(({ description: _, ...e }) => e) } });
		expect(defaultModel({ ...silent, checked: { ...(silent.checked as NonNullable<HarnessStatus["checked"]>), servedModel: "default" } }, null)).toEqual({
			id: "claude-sonnet-5-5",
			name: "Sonnet 5.5",
		});
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

	it("keeps version points apart and names an ambiguous match by its id (#805)", () => {
		const nova = (names: string[]) =>
			opencode({
				models: {
					source: "harness",
					asOf: "",
					entries: names.map((name, i) => ({
						id: `x/m${i}`,
						name,
						status: null,
					})),
				},
			});
		expect(modelName(nova(["Nova 1.3"]), "Nova 13")).toBe("Nova 13");
		expect(modelName(nova(["Nova 1.3"]), "nova-1-3")).toBe("Nova 1.3");
		expect(modelName(nova(["Nova 1.3", "nova-1.3"]), "Nova 1.3 ")).toBe(
			"Nova 1.3 ",
		);
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

describe("no Default row, real names and only runnable agents (#902 f10, #907)", () => {
	const withDefault = claude({
		models: {
			source: "harness",
			asOf: "",
			entries: [
				{ id: "default", name: "Default (recommended)", status: null },
				{ id: "claude-sonnet-5-5", name: "Sonnet 5.5", status: null },
			],
		},
	});
	const codex = claude({ id: "codex", label: "Codex", runnable: false });
	const render = (model: string) => {
		hooks.harnesses = [withDefault, codex];
		hooks.settings = { harness: "claude-code", models: model ? { "claude-code": model } : {} };
		return renderToStaticMarkup(
			React.createElement(ModelChip, { harness: withDefault, model, onPick: vi.fn() }),
		);
	};

	it("lists the models by name, with no Default row and not the agent's own entry", () => {
		const html = render("");
		expect(html).not.toContain('data-testid="model-default"');
		expect(html).not.toContain(">Default<");
		expect(html).not.toContain("Default (recommended)");
		expect(html.match(/data-testid="model-option"/g)).toHaveLength(1);
	});

	it("ticks the model the agent runs when none is picked, or the folded id is stored", () => {
		for (const stored of ["", "default"]) {
			const html = render(stored);
			expect(html).toMatch(/data-model="Sonnet 5.5"[^>]*data-checked=""/);
		}
		expect(chipModel(withDefault, "default")).toBe("Sonnet 5.5");
	});

	it("stars the agent's model: the one a run uses with none picked", () => {
		const html = render("claude-sonnet-5-5");
		expect(html).toContain('aria-label="Unstar Sonnet 5.5"');
		expect(html).toContain('aria-pressed="true"');
	});

	it("gives an agent that can't run no rail tile", () => {
		const html = render("");
		expect(html).toContain('data-testid="rail-claude-code"');
		expect(html).not.toContain('data-testid="rail-codex"');
	});
});
