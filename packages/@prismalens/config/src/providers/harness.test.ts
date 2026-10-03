// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { afterEach, describe, expect, it, vi } from "vitest";
import {
	refuseModel,
	getHarnessProviderKeys,
	HARNESS_REGISTRY,
	PERMISSION_MODES,
	resolveHarnessModel,
	resolvePermissionOutcome,
	resumeBlockedReason,
	SANDBOX_DEFAULT,
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
		expect(config.permission).toMatchObject({
			webfetch: "deny",
			websearch: "deny",
			external_directory: "deny",
		});
		expect(config.experimental).toEqual({ continue_loop_on_deny: true });
	});

	it("claude-code takes the operator's model for every tier", () => {
		const env = HARNESS_REGISTRY["claude-code"].acpEnv({ ...runEnv, model: "gemma4:31b-cloud" });
		for (const key of ["ANTHROPIC_MODEL", "ANTHROPIC_DEFAULT_SONNET_MODEL", "ANTHROPIC_DEFAULT_HAIKU_MODEL", "CLAUDE_CODE_SUBAGENT_MODEL"]) {
			expect(env[key]).toBe("gemma4:31b-cloud");
		}
		expect(HARNESS_REGISTRY["claude-code"].acpEnv(runEnv).ANTHROPIC_MODEL).toBeUndefined();
	});

	it("codex's mode comes from the access level, not its base env (r4 R4.1 rev)", () => {
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

	it("claude-code loads no setting sources from the snapshot", () => {
		expect(HARNESS_REGISTRY["claude-code"].sessionMeta?.()).toEqual({
			claudeCode: { options: { settingSources: [] } },
		});
	});

	it("gemini marks workspace untrusted to keep repo config inert (#634)", () => {
		expect(HARNESS_REGISTRY.gemini.acpEnv(runEnv)).toMatchObject({
			GEMINI_CLI_TRUST_WORKSPACE: "false",
		});
		expect(HARNESS_REGISTRY.gemini.access["read-only"].mechanism).toContain(
			"GEMINI_CLI_TRUST_WORKSPACE=false",
		);
	});
});

describe("row data every reader needs (#634)", () => {
	it("gives every row a non-empty loginHint and a mechanism at every access level", () => {
		for (const [id, descriptor] of Object.entries(HARNESS_REGISTRY)) {
			expect(descriptor.loginHint.length, `${id} loginHint`).toBeGreaterThan(0);
			for (const level of PERMISSION_MODES) {
				expect(descriptor.access[level].mechanism.length, `${id} ${level}`).toBeGreaterThan(0);
			}
		}
	});

	it("gives every row a modelVia matching how it actually takes a model", () => {
		expect(HARNESS_REGISTRY.opencode.modelVia).toBe("config");
		expect(HARNESS_REGISTRY["claude-code"].modelVia).toBe("env");
		expect(HARNESS_REGISTRY.codex.modelVia).toBe("unsupported");
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

	it("falls back to the row's verified default, never the harness's own", () => {
		expect(resolveHarnessModel("opencode")).toEqual({
			model: HARNESS_REGISTRY.opencode.defaultModel,
			source: "product-default",
		});
		expect(HARNESS_REGISTRY.opencode.defaultModel).toBe("opencode/muse-spark-1.3-contributor-free");
	});

	it("names the harness default as the source when a row has none", () => {
		expect(resolveHarnessModel("gemini", "")).toEqual({ source: "harness-default" });
	});
});

describe("refuseModel (#639 rec 4)", () => {
	it("refuses a model on a harness that cannot take one, and nothing else", () => {
		expect(refuseModel("codex", "synthetic/model-a")).toBe(
			"Codex picks its own model. Clear synthetic/model-a in the picker above.",
		);
		expect(refuseModel("codex", undefined)).toBeNull();
		expect(refuseModel("codex", "  ")).toBeNull();
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

describe("access levels (r4 R4.1)", () => {
	it("offers the four levels, Read-only first", () => {
		expect(PERMISSION_MODES).toEqual(["read-only", "read-only-tools", "workspace-write", "full-access"]);
	});

	it("records the level and the second layer it set", () => {
		const outcome = resolvePermissionOutcome("claude-code", "full-access");
		expect(outcome).toMatchObject({ mode: "full-access", agentMode: "bypassPermissions", fidelity: "cooperative" });
		expect(resolvePermissionOutcome("claude-code").agentMode).toBe("default");
		expect(resolvePermissionOutcome("deepagents", "read-only").mechanism).toContain("enforced by PrismaLens only");
		expect(resolvePermissionOutcome("deepagents", "read-only").agentMode).toBeNull();
	});

	it("tightens OpenCode's edit to deny at the read levels and opens it with the level", () => {
		const row = HARNESS_REGISTRY.opencode;
		const config = JSON.parse(row.configFiles?.({ configDir: "/c", dataDir: "/d", cwd: "/w" })["opencode.json"] ?? "{}");
		expect(config.permission).toMatchObject({ edit: "deny", bash: "ask", webfetch: "deny" });
		expect(resolvePermissionOutcome("opencode", "read-only").configPatch).toBeUndefined();
		expect(resolvePermissionOutcome("opencode", "workspace-write").configPatch).toEqual({ permission: { edit: "ask" } });
		expect(resolvePermissionOutcome("opencode", "full-access").configPatch).toEqual({
			permission: { edit: "allow", bash: "allow", webfetch: "allow", websearch: "allow", external_directory: "allow" },
		});
	});

	it("Given Codex with the sandbox switch off, When a run starts at read-only, Then agent-full-access and cooperative", () => {
		for (const level of ["read-only", "read-only-tools"] as const) {
			const off = resolvePermissionOutcome("codex", level, { sandbox: false });
			expect(off.env.INITIAL_AGENT_MODE).toBe("agent-full-access");
			expect(off.fidelity).toBe("cooperative");
			expect(off.mechanism).toBe("Codex sandbox off (agent-full-access); PrismaLens gate only");
		}
	});

	it("Given Codex with the sandbox switch on, When a run starts at read-only, Then read-only and enforced", () => {
		for (const level of ["read-only", "read-only-tools"] as const) {
			const on = resolvePermissionOutcome("codex", level, { sandbox: true });
			expect(on.env.INITIAL_AGENT_MODE).toBe("read-only");
			expect(on.fidelity).toBe("enforced");
			expect(on.mechanism).toBe("Codex read-only sandbox (no network)");
		}
	});

	it("keeps Codex's sandbox on when the operator has not set the switch (SANDBOX_DEFAULT, pending the operator)", () => {
		expect(SANDBOX_DEFAULT).toBe(true);
		expect(resolvePermissionOutcome("codex", "read-only")).toMatchObject({
			env: { INITIAL_AGENT_MODE: "read-only" },
			fidelity: "enforced",
		});
	});

	it("leaves the write levels alone when the sandbox switch is on, and ignores it for other agents", () => {
		expect(resolvePermissionOutcome("codex", "workspace-write", { sandbox: true })).toMatchObject({
			env: { INITIAL_AGENT_MODE: "agent" },
			fidelity: "cooperative",
		});
		expect(resolvePermissionOutcome("codex", "full-access", { sandbox: true }).env.INITIAL_AGENT_MODE).toBe("agent-full-access");
		expect(resolvePermissionOutcome("opencode", "read-only", { sandbox: true }).fidelity).toBe("cooperative");
	});
});
