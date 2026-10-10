// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { AccessLevel, HarnessId, RunMode } from "@prismalens/config/harness";
import {
	ACCESS_LEVEL_LABEL,
	type AxisSource,
	type HarnessStatus,
	NO_SANDBOX,
	RUN_MODE_LABEL,
	type SandboxCheck,
} from "@prismalens/contracts";
import { describe, expect, it } from "vitest";
import {
	accessChipText,
	agentNote,
	defaultTag,
	levelIcon,
	levelRowLine,
	levelSandbox,
	modeLine,
	offersPlan,
	permissionLine,
	planIsCoupled,
	runModeId,
	sandboxLine,
} from "./access-levels";

const mockHarness = (
	id: HarnessId,
	over: Partial<HarnessStatus> = {},
): HarnessStatus => ({
	id,
	label: id === "claude-code" ? "Claude Code" : id === "gemini" ? "Gemini CLI" : id === "codex" ? "Codex" : id === "opencode" ? "OpenCode" : "deepagents",
	binary: id,
	installed: true,
	tested: null,
	install: "",
	defaultModel: null,
	localDefault: { permission: null, mode: null },
	modelVia: "acp",
	loginHint: "",
	envModel: null,
	windowsOnlyPath: null,
	models: { source: "harness", asOf: "", entries: [] },
	checked: null,
	...over,
});

describe("levelIcon and sandboxLine (#673 w51)", () => {
	const enforced: SandboxCheck = {
		state: "enforced",
		reason: "sandbox active",
	};
	const none: SandboxCheck = {
		state: "none",
		reason: "no sandbox",
	};
	const unknown: SandboxCheck = {
		state: "unknown",
		reason: "timed out",
	};

	it("levelIcon returns 'lock' only when enforced, null otherwise", () => {
		expect(levelIcon(enforced)).toBe("lock");
		expect(levelIcon(none)).toBeNull();
		expect(levelIcon(unknown)).toBeNull();
		expect(levelIcon(undefined)).toBeNull();
		expect(levelIcon(null)).toBeNull();
	});

	it("sandboxLine returns expected strings", () => {
		expect(sandboxLine(enforced)).toBe("Sandboxed: sandbox active.");
		expect(sandboxLine(none)).toBe(NO_SANDBOX);
		expect(sandboxLine(unknown)).toBe("Sandbox unknown: timed out.");
		expect(sandboxLine(undefined)).toBe("Sandbox not checked yet.");
		expect(sandboxLine(null)).toBe("Sandbox not checked yet.");
	});
});

describe("defaultTag", () => {
	it("returns expected tag for each axis source", () => {
		expect(defaultTag("agent")).toBe("Your default");
		expect(defaultTag("prismalens")).toBe("PrismaLens default");
		expect(defaultTag("settings")).toBe("From Settings");
		expect(defaultTag("auto-settings")).toBe("From Settings");
	});
});

describe("planIsCoupled and accessChipText", () => {
	it("planIsCoupled is true for claude-code and gemini, false for others", () => {
		expect(planIsCoupled(mockHarness("claude-code"))).toBe(true);
		expect(planIsCoupled(mockHarness("gemini"))).toBe(true);
		expect(planIsCoupled(mockHarness("codex"))).toBe(false);
		expect(planIsCoupled(mockHarness("opencode"))).toBe(false);
		expect(planIsCoupled(mockHarness("deepagents"))).toBe(false);
		expect(planIsCoupled(undefined)).toBe(false);
	});

	it("accessChipText returns level in Execute", () => {
		expect(accessChipText(mockHarness("claude-code"), "supervised", "execute")).toBe("Ask always");
		expect(accessChipText(mockHarness("codex"), "auto-edits", "execute")).toBe("Auto-accept edits");
	});

	it("accessChipText in Plan returns 'Plan' on coupled harnesses, and 'Plan, <Level>' on uncoupled", () => {
		expect(accessChipText(mockHarness("claude-code"), "supervised", "plan")).toBe("Plan");
		expect(accessChipText(mockHarness("gemini"), "supervised", "plan")).toBe("Plan");
		expect(accessChipText(mockHarness("codex"), "supervised", "plan")).toBe("Plan, Ask always");
		expect(accessChipText(mockHarness("opencode"), "auto", "plan")).toBe("Plan, Auto");
	});
});

describe("offersPlan", () => {
	it("returns true only when harness registry has planMode and checked.plan is true", () => {
		expect(offersPlan(undefined)).toBe(false);
		expect(offersPlan(mockHarness("claude-code", { checked: null }))).toBe(false);
		expect(offersPlan(mockHarness("claude-code", { checked: { at: "", outcome: "answers-acp", detail: "", servedModel: null, effort: null, modes: [], efforts: [], images: false, plan: false, sandbox: null } }))).toBe(false);
		expect(offersPlan(mockHarness("claude-code", { checked: { at: "", outcome: "answers-acp", detail: "", servedModel: null, effort: null, modes: [], efforts: [], images: false, plan: true, sandbox: null } }))).toBe(true);
		expect(offersPlan(mockHarness("deepagents", { checked: { at: "", outcome: "answers-acp", detail: "", servedModel: null, effort: null, modes: [], efforts: [], images: false, plan: true, sandbox: null } }))).toBe(false);
	});
});

describe("permissionLine variants (§1 Settings lines)", () => {
	it("operator set: '<label>, set here.'", () => {
		expect(permissionLine(mockHarness("claude-code"), "supervised")).toBe("Ask always, set here.");
		expect(permissionLine(mockHarness("codex"), "full-access")).toBe("Full access, set here.");
	});

	it("deepagents: 'Ask always, PrismaLens default. deepagents has no modes.'", () => {
		expect(permissionLine(mockHarness("deepagents"), undefined)).toBe(
			"Ask always, PrismaLens default. deepagents has no modes.",
		);
	});

	it("opencode: 'Ask always, PrismaLens default. OpenCode has per-tool rules, not one permission level.'", () => {
		expect(permissionLine(mockHarness("opencode"), undefined)).toBe(
			"Ask always, PrismaLens default. OpenCode has per-tool rules, not one permission level.",
		);
	});

	it("key absent: '<default label>, PrismaLens default. No default set in <file>.'", () => {
		expect(permissionLine(mockHarness("claude-code"), undefined)).toBe(
			"Ask always, PrismaLens default. No default set in ~/.claude/settings.json.",
		);
		expect(permissionLine(mockHarness("codex"), undefined)).toBe(
			"Ask always, PrismaLens default. No default set in ~/.codex/config.toml.",
		);
		expect(permissionLine(mockHarness("gemini"), undefined)).toBe(
			"Ask always, PrismaLens default. No default set in ~/.gemini/settings.json.",
		);
	});

	it("mapped: 'Your default: <label>, from <file> (\"<value>\").'", () => {
		const h = mockHarness("claude-code", {
			localDefault: {
				permission: { level: "auto", file: "~/.claude/settings.json", value: "auto" },
				mode: null,
			},
		});
		expect(permissionLine(h, undefined)).toBe(
			'Your default: Auto, from ~/.claude/settings.json ("auto").',
		);
	});

	it("present, cannot run here (Gemini reason): '<default label>, PrismaLens default. <reason>, so \"<value>\" cannot apply.'", () => {
		const h = mockHarness("gemini", {
			localDefault: {
				permission: {
					level: null,
					file: "~/.gemini/settings.json",
					value: "auto_edit",
					reason: "Gemini CLI runs the copy untrusted here",
				},
				mode: null,
			},
		});
		expect(permissionLine(h, undefined)).toBe(
			'Ask always, PrismaLens default. Gemini CLI runs the copy untrusted here, so "auto_edit" cannot apply.',
		);
	});

	it("present, no equivalent: '<default label>, PrismaLens default. Your <agent> default \"<value>\" in <file> has no PrismaLens Permission.'", () => {
		const h = mockHarness("claude-code", {
			localDefault: {
				permission: { level: null, file: "~/.claude/settings.json", value: "dontAsk" },
				mode: null,
			},
		});
		expect(permissionLine(h, undefined)).toBe(
			'Ask always, PrismaLens default. Your Claude Code default "dontAsk" in ~/.claude/settings.json has no PrismaLens Permission.',
		);
	});
});

describe("modeLine variants (§1 Settings lines)", () => {
	it("operator set: '<label>, set here.'", () => {
		expect(modeLine(mockHarness("claude-code"), "plan")).toBe("Plan, set here.");
		expect(modeLine(mockHarness("claude-code"), "execute")).toBe("Execute, set here.");
	});

	it("deepagents: 'Execute, PrismaLens default. deepagents has no modes.'", () => {
		expect(modeLine(mockHarness("deepagents"), undefined)).toBe(
			"Execute, PrismaLens default. deepagents has no modes.",
		);
	});

	it("codex when absent: 'Execute, PrismaLens default.'", () => {
		expect(modeLine(mockHarness("codex"), undefined)).toBe(
			"Execute, PrismaLens default.",
		);
	});

	it("key absent for other agents: '<default label>, PrismaLens default. No default set in <file>.'", () => {
		expect(modeLine(mockHarness("claude-code"), undefined)).toBe(
			"Execute, PrismaLens default. No default set in ~/.claude/settings.json.",
		);
		expect(modeLine(mockHarness("gemini"), undefined)).toBe(
			"Execute, PrismaLens default. No default set in ~/.gemini/settings.json.",
		);
		expect(modeLine(mockHarness("opencode"), undefined)).toBe(
			"Execute, PrismaLens default. No default set in ~/.config/opencode/opencode.json.",
		);
	});

	it("mapped: 'Your default: <label>, from <file> (\"<value>\").'", () => {
		const h = mockHarness("claude-code", {
			localDefault: {
				permission: null,
				mode: { mode: "plan", file: "~/.claude/settings.json", value: "plan" },
			},
		});
		expect(modeLine(h, undefined)).toBe(
			'Your default: Plan, from ~/.claude/settings.json ("plan").',
		);
	});

	it("present, no equivalent: '<default label>, PrismaLens default. Your <agent> default \"<value>\" in <file> has no PrismaLens Mode.'", () => {
		const h = mockHarness("claude-code", {
			localDefault: {
				permission: null,
				mode: { mode: null, file: "~/.claude/settings.json", value: "custom" },
			},
		});
		expect(modeLine(h, undefined)).toBe(
			'Execute, PrismaLens default. Your Claude Code default "custom" in ~/.claude/settings.json has no PrismaLens Mode.',
		);
	});
});

describe("agentNote variants (the four agent notes)", () => {
	it("Claude Code agent note", () => {
		expect(agentNote(mockHarness("claude-code"))).toBe(
			"Your ~/.claude/settings.json allow and deny rules, hooks and sandbox apply, as in your terminal. The terminal's own default may be Auto on Claude Code 2.1.228 and later; PrismaLens reads the key, not that default.",
		);
	});

	it("Codex agent note when checked.modes lacks workspace-write", () => {
		const codexWithoutWorkspaceWrite = mockHarness("codex", {
			checked: {
				at: "",
				outcome: "answers-acp",
				detail: "",
				servedModel: null,
				effort: null,
				modes: [{ id: "read-only", name: "Ask for approval" }],
				efforts: [],
				images: false,
				plan: false,
				sandbox: null,
			},
		});
		expect(agentNote(codexWithoutWorkspaceWrite)).toBe(
			"This codex-acp runs Ask always and Auto-accept edits in the same mode, Ask for approval; edits inside the copy need no ask.",
		);

		const codexWithWorkspaceWrite = mockHarness("codex", {
			checked: {
				at: "",
				outcome: "answers-acp",
				detail: "",
				servedModel: null,
				effort: null,
				modes: [
					{ id: "read-only", name: "Ask for approval" },
					{ id: "workspace-write", name: "Workspace write" },
				],
				efforts: [],
				images: false,
				plan: false,
				sandbox: null,
			},
		});
		expect(agentNote(codexWithWorkspaceWrite)).toBeNull();
	});

	it("OpenCode agent note", () => {
		expect(agentNote(mockHarness("opencode"))).toBe(
			"Your opencode.json rules stay; PrismaLens sets each tool's catch-all for the level.",
		);
	});

	it("Gemini CLI agent note", () => {
		expect(agentNote(mockHarness("gemini"))).toBe(
			"Gemini CLI runs the copy untrusted, so it offers Ask always and Plan here; the other levels run as Ask always.",
		);
	});

	it("deepagents has no agent note", () => {
		expect(agentNote(mockHarness("deepagents"))).toBeNull();
	});
});

describe("levelRowLine, runModeId, and levelSandbox", () => {
	it("levelRowLine reflects the agent's own mode", () => {
		expect(levelRowLine(mockHarness("claude-code"), "supervised")).toBe("Claude Code runs in Manual.");
		expect(levelRowLine(mockHarness("codex"), "supervised")).toBe("Codex runs in Ask for approval.");
	});

	it("runModeId resolves mode id for level and runMode", () => {
		expect(runModeId(mockHarness("claude-code"), "supervised", "execute")).toBe("default");
		expect(runModeId(mockHarness("claude-code"), "supervised", "plan")).toBe("plan");
	});

	it("levelSandbox returns sandbox check from checked.sandbox", () => {
		const h = mockHarness("claude-code", {
			checked: {
				at: "",
				outcome: "answers-acp",
				detail: "",
				servedModel: null,
				effort: null,
				modes: [],
				efforts: [],
				images: false,
				plan: true,
				sandbox: {
					default: { state: "enforced", reason: "sandbox active" },
				},
			},
		});
		expect(levelSandbox(h, "supervised", "execute")?.state).toBe("enforced");
		expect(levelSandbox(undefined, "supervised")).toBeUndefined();
	});
});
