// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { afterEach, describe, expect, it, vi } from "vitest";
import {
	refuseModel,
	getHarnessProviderKeys,
	HARNESS_REGISTRY,
	modeFidelity,
	runsInSandbox,
	resolveHarnessModel,
	resumeBlockedReason,
	ACCESS_LEVELS,
	levelOfAgentMode,
	mergeConfigPatch,
} from "./harness.js";

afterEach(() => {
	vi.unstubAllEnvs();
});

describe("getHarnessProviderKeys (ADR 0004 §5, trust floor)", () => {
	it("returns only the registry row's provider keys present in the source env", () => {
		const env = {
			ANTHROPIC_API_KEY: "sk-ant-test",
			OPENAI_API_KEY: "sk-oai-test",
			UNRELATED_VAR: "noise",
		};
		expect(getHarnessProviderKeys("claude-code", env)).toEqual({
			ANTHROPIC_API_KEY: "sk-ant-test",
		});
	});

	it("never returns a PRISMALENS_* key, even if a row were misconfigured to list one", () => {
		const original = HARNESS_REGISTRY["claude-code"].providerKeys;
		HARNESS_REGISTRY["claude-code"].providerKeys = [
			"PRISMALENS_AUTH_SECRET",
			"ANTHROPIC_API_KEY",
		];
		try {
			const result = getHarnessProviderKeys("claude-code", {
				PRISMALENS_AUTH_SECRET: "leak-me",
				ANTHROPIC_API_KEY: "sk-ant-test",
			});
			expect(result.PRISMALENS_AUTH_SECRET).toBeUndefined();
			expect(result.ANTHROPIC_API_KEY).toBe("sk-ant-test");
		} finally {
			HARNESS_REGISTRY["claude-code"].providerKeys = original;
		}
	});

	it("passes a gateway's model keys to Claude Code (walk f18)", () => {
		expect(
			getHarnessProviderKeys("claude-code", {
				ANTHROPIC_BASE_URL: "http://localhost:11434",
				ANTHROPIC_MODEL: "gemma4:31b-cloud",
			}),
		).toEqual({
			ANTHROPIC_BASE_URL: "http://localhost:11434",
			ANTHROPIC_MODEL: "gemma4:31b-cloud",
		});
	});

	it("omits a provider key the source env does not set", () => {
		expect(getHarnessProviderKeys("gemini", {})).toEqual({});
	});

	it("defaults to process.env when no source env is given", () => {
		vi.stubEnv("GEMINI_API_KEY", "test-gemini-key");
		expect(getHarnessProviderKeys("gemini")).toEqual({
			GEMINI_API_KEY: "test-gemini-key",
		});
	});

	it("lists real provider keys for every multi-provider harness row, never a bare wildcard", () => {
		for (const [id, descriptor] of Object.entries(HARNESS_REGISTRY)) {
			for (const key of descriptor.providerKeys ?? []) {
				expect(key.endsWith("*"), `${id} providerKeys must not use a wildcard`).toBe(
					false,
				);
			}
		}
	});
});

describe("harness isolation (ADR 0004 §1, #637)", () => {
	const runEnv = {
		configDir: "/c",
		dataDir: "/d",
		cwd: "/w",
	};

	it("opencode ignores the snapshot's own config and keeps looping after a refusal", () => {
		const row = HARNESS_REGISTRY.opencode;
		expect(row.acpEnv(runEnv)).toMatchObject({
			OPENCODE_DISABLE_PROJECT_CONFIG: "1",
			OPENCODE_DISABLE_CLAUDE_CODE: "1",
		});
		const config = JSON.parse(row.configFiles?.(runEnv)["opencode.json"] ?? "{}");
		expect(config.permission).toBeUndefined();
		expect(config.share).toBe("disabled");
		expect(config.experimental).toEqual({ continue_loop_on_deny: true });
	});

	it("opencode keeps the user's own config home, so their model, providers and agents apply (#791)", () => {
		expect(HARNESS_REGISTRY.opencode.acpEnv({ cwd: "/r", configDir: "/c", dataDir: "/d" })).toEqual({
			OPENCODE_CONFIG_DIR: "/c",
			OPENCODE_DISABLE_PROJECT_CONFIG: "1",
			OPENCODE_DISABLE_CLAUDE_CODE: "1",
		});
	});

	it("claude-code takes the operator's model over ACP, never from an env it writes (R4.2)", () => {
		const env = HARNESS_REGISTRY["claude-code"].acpEnv({ ...runEnv, model: "gemma4:31b-cloud" });
		for (const key of ["ANTHROPIC_MODEL", "ANTHROPIC_DEFAULT_SONNET_MODEL", "ANTHROPIC_DEFAULT_HAIKU_MODEL", "CLAUDE_CODE_SUBAGENT_MODEL"]) {
			expect(env[key]).toBeUndefined();
		}
	});

	it("codex's mode comes from the run's mode, not its base env (#673 w21)", () => {
		expect(HARNESS_REGISTRY.codex.acpEnv(runEnv).INITIAL_AGENT_MODE).toBeUndefined();
	});

	it("deepagents runs dcode's ACP server with no MCP servers (#634)", () => {
		expect(HARNESS_REGISTRY.deepagents.binary).toBe("dcode");
		expect(HARNESS_REGISTRY.deepagents.acpArgs(runEnv)).toEqual([
			"--acp",
			"--no-mcp",
		]);
	});

	it("claude-code, codex and gemini keep the user's own config and sign-in", () => {
		for (const id of ["claude-code", "codex", "gemini"] as const) {
			const env = HARNESS_REGISTRY[id].acpEnv(runEnv);
			for (const key of ["CLAUDE_CONFIG_DIR", "CODEX_HOME", "GEMINI_CLI_HOME", "HOME"]) {
				expect(env[key], `${id} ${key}`).toBeUndefined();
			}
		}
	});

	it("claude-code drives the PATH claude, never a second bundled binary (#650)", () => {
		expect(
			HARNESS_REGISTRY["claude-code"].acpEnv({
				...runEnv,
				companionPath: "/usr/local/bin/claude",
			}).CLAUDE_CODE_EXECUTABLE,
		).toBe("/usr/local/bin/claude");
		expect(
			HARNESS_REGISTRY["claude-code"].acpEnv(runEnv).CLAUDE_CODE_EXECUTABLE,
		).toBeUndefined();
	});

	it("claude-code loads the user's settings, never the snapshot's", () => {
		expect(HARNESS_REGISTRY["claude-code"].sessionMeta?.()).toEqual({
			claudeCode: { options: { settingSources: ["user"] } },
		});
	});

	it("gemini marks workspace untrusted to keep repo config inert (#634)", () => {
		expect(HARNESS_REGISTRY.gemini.acpEnv(runEnv)).toMatchObject({
			GEMINI_CLI_TRUST_WORKSPACE: "false",
		});
	});
});

describe("row data every reader needs (#634)", () => {
	it("gives every row a non-empty loginHint", () => {
		for (const [id, descriptor] of Object.entries(HARNESS_REGISTRY)) {
			expect(descriptor.loginHint.length, `${id} loginHint`).toBeGreaterThan(0);
		}
	});

	it("gives every row a modelVia matching how it actually takes a model", () => {
		expect(HARNESS_REGISTRY.opencode.modelVia).toBe("acp");
		expect(HARNESS_REGISTRY["claude-code"].modelVia).toBe("acp");
		expect(HARNESS_REGISTRY.codex.modelVia).toBe("acp");
		expect(HARNESS_REGISTRY.gemini.modelVia).toBe("unsupported");
		expect(HARNESS_REGISTRY.deepagents.modelVia).toBe("unsupported");
	});
});

describe("gateway URL (claude-code)", () => {
	it("passes https and loopback http, refuses http to another host", () => {
		for (const ok of ["https://gw.example.com", "http://127.0.0.1:11434", "http://localhost:4000"]) {
			expect(getHarnessProviderKeys("claude-code", { ANTHROPIC_BASE_URL: ok }).ANTHROPIC_BASE_URL).toBe(ok);
		}
		expect(() =>
			getHarnessProviderKeys("claude-code", { ANTHROPIC_BASE_URL: "http://gw.lan:4000", ANTHROPIC_AUTH_TOKEN: "t" }),
		).toThrow(/must be https/);
		expect(() =>
			getHarnessProviderKeys("claude-code", { ANTHROPIC_BASE_URL: "http://127.0.0.1.evil.example/v1" }),
		).toThrow(/must be https/);
	});
});

describe("resolveHarnessModel (#337 run e, G11)", () => {
	it("takes the host env's model when the operator set none, and the operator's over it (walk f18)", () => {
		const env = { ANTHROPIC_MODEL: "gemma4:31b-cloud" };
		expect(resolveHarnessModel("claude-code", undefined, env)).toEqual({
			model: "gemma4:31b-cloud",
			source: "env",
		});
		expect(resolveHarnessModel("claude-code", "claude-sonnet-5", env)).toEqual({
			model: "claude-sonnet-5",
			source: "operator",
		});
		expect(resolveHarnessModel("claude-code", undefined, {})).toEqual({
			source: "harness-default",
		});
	});


	it("takes the operator's model first, with its source", () => {
		expect(resolveHarnessModel("opencode", " zen/free ")).toEqual({ model: "zen/free", source: "operator" });
	});

	it("ships no product default for OpenCode, so OpenCode picks its own model", () => {
		expect(HARNESS_REGISTRY.opencode.defaultModel).toBeUndefined();
		expect(resolveHarnessModel("opencode")).toEqual({ source: "harness-default" });
		expect(HARNESS_REGISTRY.opencode.configFiles?.({ cwd: "/r", configDir: "/c", dataDir: "/d" })["opencode.json"]).not.toContain(
			'"model"',
		);
	});

	it("names the harness default as the source when a row has none", () => {
		expect(resolveHarnessModel("gemini", "")).toEqual({ source: "harness-default" });
	});
});

describe("refuseModel (#639 rec 4)", () => {
	it("refuses a model on a harness that cannot take one, and nothing else", () => {
		expect(refuseModel("gemini", "synthetic/model-a")).toBe(
			"Gemini CLI picks its own model. Clear synthetic/model-a in the picker above.",
		);
		expect(refuseModel("gemini", undefined)).toBeNull();
		expect(refuseModel("gemini", "  ")).toBeNull();
		expect(refuseModel("codex", "synthetic/model-a")).toBeNull();
		expect(refuseModel("opencode", "synthetic/model-a")).toBeNull();
	});
});

describe("resumeBlockedReason (#747)", () => {
	it("is null on a row that passed the resume probe and names the harness otherwise", () => {
		expect(resumeBlockedReason("claude-code")).toBeNull();
		expect(resumeBlockedReason("gemini")).toBeNull();
		expect(resumeBlockedReason("deepagents")).toBe(
			"deepagents can't reopen a finished session, so a new run starts from the report.",
		);
	});
});

describe("sandbox and fidelity (#673 w51)", () => {
	it("runs only Codex's sandboxed modes in its sandbox, never full access", () => {
		for (const mode of ["read-only", "workspace-write", "agent"]) expect(runsInSandbox("codex", mode)).toBe(true);
		expect(runsInSandbox("codex", "agent-full-access")).toBe(false);
		expect(runsInSandbox("claude-code", "plan")).toBe(false);
		expect(runsInSandbox("opencode", null)).toBe(false);
	});

	it("calls a mode enforced only when its sandbox check says so (#673 w51)", () => {
		expect(modeFidelity({ state: "enforced", reason: "refused" })).toBe("enforced");
		expect(modeFidelity({ state: "unknown", reason: "timed out" })).toBe("cooperative");
		expect(modeFidelity({ state: "none", reason: "no sandbox" })).toBe("cooperative");
		expect(modeFidelity(undefined)).toBe("cooperative");
	});
});

describe("permission levels (ADR 0003, #673 w21 ruling 2026-10-10)", () => {
	it("gives every row access for all four levels with non-empty mechanism and non-empty line(null)", () => {
		for (const [id, descriptor] of Object.entries(HARNESS_REGISTRY)) {
			for (const level of ACCESS_LEVELS) {
				const access = descriptor.access[level];
				expect(access, `${id} missing access for ${level}`).toBeDefined();
				expect(access.mechanism.length, `${id} ${level} mechanism`).toBeGreaterThan(0);
				const line = access.line(null);
				expect(typeof line).toBe("string");
				expect(line.length, `${id} ${level} line(null)`).toBeGreaterThan(0);
			}
		}
	});

	it("never uses a plan mode as an access level mode", () => {
		const planIds = new Set(["plan"]);
		for (const [id, descriptor] of Object.entries(HARNESS_REGISTRY)) {
			for (const level of ACCESS_LEVELS) {
				const mode = descriptor.access[level].mode;
				if (mode) {
					expect(planIds.has(mode), `${id} ${level} must not use plan mode ${mode}`).toBe(false);
				}
			}
		}
	});

	it("configures harness-specific access level modes and mechanisms", () => {
		expect(HARNESS_REGISTRY["claude-code"].access["full-access"].fallbackMode).toBe("acceptEdits");
		expect(HARNESS_REGISTRY.codex.access["auto-edits"].mode).toBe("workspace-write");
		expect(HARNESS_REGISTRY.codex.access["auto-edits"].fallbackMode).toBe("read-only");
		expect(HARNESS_REGISTRY.codex.modeMechanism).toBe("acp");
		for (const level of ACCESS_LEVELS) {
			expect(HARNESS_REGISTRY.gemini.access[level].mode, `gemini ${level}`).toBe("default");
		}
	});

	it("levelOfAgentMode round-trips every non-null mode and returns null for unknown ids", () => {
		for (const [id, descriptor] of Object.entries(HARNESS_REGISTRY)) {
			const harnessId = id as keyof typeof HARNESS_REGISTRY;
			const seenModes = new Set<string>();
			for (const level of ACCESS_LEVELS) {
				const mode = descriptor.access[level].mode;
				if (mode && !seenModes.has(mode)) {
					seenModes.add(mode);
					expect(levelOfAgentMode(harnessId, mode), `${harnessId} mode ${mode}`).toBe(level);
				}
			}
			expect(levelOfAgentMode(harnessId, "unknown-mode-id")).toBeNull();
			expect(levelOfAgentMode(harnessId, null)).toBeNull();
		}
	});

	it("deep-merges opencode configPatch into opencode.json preserving pre-existing deny rules", () => {
		const baseFiles = HARNESS_REGISTRY.opencode.configFiles?.({
			cwd: "/r",
			configDir: "/c",
			dataDir: "/d",
		});
		const generated = JSON.parse(baseFiles?.["opencode.json"] ?? "{}");

		const userCustomConfig = {
			...generated,
			permission: {
				bash: {
					"rm -rf *": "deny",
				},
			},
		};

		for (const level of ACCESS_LEVELS) {
			const patch = HARNESS_REGISTRY.opencode.access[level].configPatch ?? {};
			const merged = mergeConfigPatch(userCustomConfig, patch) as Record<string, unknown>;

			const perm = merged.permission as Record<string, unknown>;
			expect(perm).toBeDefined();
			expect((perm.edit as Record<string, unknown>)["*"]).toBeDefined();
			expect((perm.bash as Record<string, unknown>)["*"]).toBeDefined();

			const agent = merged.agent as {
				build: { permission: Record<string, unknown> };
				plan: { permission: Record<string, unknown> };
			};
			expect(agent.build.permission).toBeDefined();
			expect(agent.plan.permission).toBeDefined();

			if (level === "full-access") {
				expect((perm.bash as Record<string, unknown>)["rm -rf *"]).toBe("deny");
			}
		}
	});

	it("contains no inspiration names", () => {
		const forbidden = /t3code|t3 code|\bT3('s)?\b|traycer|pingdotgg/i;
		for (const [id, descriptor] of Object.entries(HARNESS_REGISTRY)) {
			expect(descriptor.label).not.toMatch(forbidden);
			for (const level of ACCESS_LEVELS) {
				const line = descriptor.access[level].line(null);
				expect(line).not.toMatch(forbidden);
			}
		}
	});
});

