// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { execFileSync, spawnSync } from "node:child_process";
import {
	copyFileSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AgentHostError } from "./errors.js";
import {
	claudeCleanIsolation,
	claudeProbeIsolation,
	codexCleanIsolation,
	codexProbeIsolation,
	GATEWAY_RUN_FILE,
	geminiCleanIsolation,
	geminiProbeIsolation,
	type Isolation,
	opencodeCleanIsolation,
	opencodeProbeIsolation,
} from "./registry/index.js";
import {
	GITHUB_TOKEN_VARS,
	type LaunchPolicy,
	type PlanLaunchInput,
	planLaunch,
	SAFE_ENV_ALLOWLIST,
	writeLaunchFiles,
} from "./launch.js";

const POLICY: LaunchPolicy = {
	userSetup: "inherit",
	github: "include",
	refuseEnvPrefixes: ["PRISMALENS_"],
};

const HOST = {
	PATH: process.env.PATH,
	HOME: "/home/u",
	ENCRYPTION_KEY: "secret",
	OLLAMA_API_KEY: "secret",
	ANTHROPIC_API_KEY: "host-key",
	OPENAI_API_KEY: "host-openai",
	PRISMALENS_DB: "x",
	GH_TOKEN: "ghp",
	GITHUB_TOKEN: "ghs",
	GH_ENTERPRISE_TOKEN: "ghe",
	GITHUB_ENTERPRISE_TOKEN: "ghe2",
	RANDOM_HOST_VAR: "nope",
};

const dirs: string[] = [];
afterEach(() => {
	for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function plan(over: Partial<PlanLaunchInput> = {}) {
	return planLaunch({
		agent: "claude-code",
		level: "supervised",
		policy: POLICY,
		launch: { command: "claude-agent-acp" },
		cwd: "/w",
		runDir: "/run",
		hostEnv: HOST,
		...over,
	});
}

describe("planLaunch env", () => {
	it("lets no host variable outside the floor, the row's keys or extraAllow reach the child", () => {
		const env = plan({
			policy: { ...POLICY, floor: { mode: "allowlist", extraAllow: ["RANDOM_HOST_VAR"] } },
		}).env;
		const allowed = new Set<string>([
			...SAFE_ENV_ALLOWLIST,
			"RANDOM_HOST_VAR",
			"ANTHROPIC_API_KEY",
		]);
		for (const key of Object.keys(HOST))
			if (key in env) expect(allowed.has(key), key).toBe(true);
		expect(env.ENCRYPTION_KEY).toBeUndefined();
		expect(env.OPENAI_API_KEY).toBeUndefined();
		expect(env.RANDOM_HOST_VAR).toBe("nope");
		expect(plan().env.RANDOM_HOST_VAR).toBeUndefined();
	});

	it("drops a refuseEnvPrefixes name even from the overrides and stored values", () => {
		const env = plan({
			stored: { PRISMALENS_STORED: "1" },
			overrides: { PRISMALENS_SECRET: "1", KEEP_ME: "1" },
		}).env;
		expect(env.PRISMALENS_SECRET).toBeUndefined();
		expect(env.PRISMALENS_STORED).toBeUndefined();
		expect(env.KEEP_ME).toBe("1");
	});

	it("throws unsafe-gateway-url for a plain-http ANTHROPIC_BASE_URL that isn't loopback", () => {
		const run = () => plan({ hostEnv: { ...HOST, ANTHROPIC_BASE_URL: "http://gw.example" } });
		expect(run).toThrow(AgentHostError);
		try {
			run();
		} catch (e) {
			expect((e as AgentHostError).code).toBe("unsafe-gateway-url");
		}
		expect(plan({ stored: { ANTHROPIC_BASE_URL: "http://127.0.0.1:8080" } }).env.ANTHROPIC_BASE_URL).toBe(
			"http://127.0.0.1:8080",
		);
	});

	it("holds a row to a host gateway URL only when it reads ANTHROPIC_BASE_URL or the user stored one", () => {
		const hostEnv = { ...HOST, ANTHROPIC_BASE_URL: "http://gw.lan:4000" };
		const floor = { mode: "inherit-minus-own-secrets", ownSecrets: {} } as const;
		const policy = { ...POLICY, floor };
		expect(() => plan({ agent: "codex", launch: { command: "codex-acp" }, policy, hostEnv })).not.toThrow();
		expect(() => plan({ policy, hostEnv })).toThrow(/ANTHROPIC_BASE_URL/);
		expect(() =>
			plan({
				agent: "codex",
				launch: { command: "codex-acp" },
				policy,
				hostEnv,
				stored: { ANTHROPIC_BASE_URL: "http://gw.lan:4000" },
			}),
		).toThrow(/ANTHROPIC_BASE_URL/);
	});

	it("layers floor, row keys, stored values, then overrides, last wins", () => {
		const p = plan({
			hostEnv: { ...HOST, HOME: "/host-home" },
			stored: { ANTHROPIC_API_KEY: "stored-key", HOME: "/stored-home" },
			overrides: { HOME: "/override-home" },
		});
		expect(p.env.ANTHROPIC_API_KEY).toBe("stored-key");
		expect(p.env.HOME).toBe("/override-home");
		expect(p.env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC).toBe("1");
	});

	it.each([
		["a gateway from the host", { hostEnv: { ...HOST, ANTHROPIC_BASE_URL: "https://gw.example.com" } }, "0"],
		["a stored custom URL", { stored: { ANTHROPIC_BASE_URL: "http://127.0.0.1:8080" } }, "0"],
		["Anthropic's own host", { hostEnv: { ...HOST, ANTHROPIC_BASE_URL: "https://api.anthropic.com" } }, undefined],
		["no base URL", {}, undefined],
		["a gateway only in overrides", { overrides: { ANTHROPIC_BASE_URL: "https://gw.example.com" } }, "0"],
		[
			"Anthropic's host in overrides over a host gateway",
			{
				hostEnv: { ...HOST, ANTHROPIC_BASE_URL: "https://gw.example.com" },
				overrides: { ANTHROPIC_BASE_URL: "https://api.anthropic.com" },
			},
			undefined,
		],
		[
			"a gateway whose name the policy refuses",
			{
				hostEnv: { ...HOST, ANTHROPIC_BASE_URL: "https://gw.example.com" },
				policy: { ...POLICY, refuseEnvNames: ["ANTHROPIC_BASE_URL"] },
			},
			undefined,
		],
	] as const)("sets CLAUDE_CODE_AUTO_MODE_SERVER for claude-code only behind a gateway: %s", (_name, over, want) => {
		expect(plan(over).env.CLAUDE_CODE_AUTO_MODE_SERVER).toBe(want);
	});

	describe("on Windows, where env names ignore case", () => {
		const platform = Object.getOwnPropertyDescriptor(process, "platform");
		beforeEach(() => {
			Object.defineProperty(process, "platform", { value: "win32" });
		});
		afterEach(() => {
			if (platform) Object.defineProperty(process, "platform", platform);
		});

		it("sees a gateway an override names anthropic_base_url", () => {
			const p = plan({ overrides: { anthropic_base_url: "https://gw.example.com" } });
			expect(p.env.CLAUDE_CODE_AUTO_MODE_SERVER).toBe("0");
		});

		it("holds a lowercase anthropic_base_url to the https rule", () => {
			expect(() => plan({ overrides: { anthropic_base_url: "http://gw.lan:4000" } })).toThrow(
				/ANTHROPIC_BASE_URL must be https/,
			);
		});
	});

	it("lets a stored CLAUDE_CODE_AUTO_MODE_SERVER reach Claude Code under Anthropic's own host", () => {
		expect(plan({ stored: { CLAUDE_CODE_AUTO_MODE_SERVER: "0" } }).env.CLAUDE_CODE_AUTO_MODE_SERVER).toBe("0");
	});

	it("reports each variable as Not set, Key set or From environment", () => {
		const p = plan({ stored: { ANTHROPIC_AUTH_TOKEN: "t" } });
		expect(p.envState.ANTHROPIC_AUTH_TOKEN).toBe("key-set");
		expect(p.envState.ANTHROPIC_API_KEY).toBe("from-environment");
		expect(p.envState.ANTHROPIC_MODEL).toBe("not-set");
		expect(p.envState.CLAUDE_CONFIG_DIR).toBe("not-set");
	});

	it("inherit-minus-own-secrets passes the host env except the product's own secrets", () => {
		const env = plan({
			policy: {
				...POLICY,
				floor: {
					mode: "inherit-minus-own-secrets",
					ownSecrets: { names: ["ENCRYPTION_KEY", "OLLAMA_API_KEY"], prefixes: ["PRISMALENS_"] },
				},
			},
		}).env;
		expect(env.RANDOM_HOST_VAR).toBe("nope");
		expect(env.OPENAI_API_KEY).toBe("host-openai");
		expect(env.ENCRYPTION_KEY).toBeUndefined();
		expect(env.PRISMALENS_DB).toBeUndefined();
	});

	it("drops the product's own secrets even when a later layer sets them", () => {
		const env = plan({
			policy: {
				...POLICY,
				floor: { mode: "inherit-minus-own-secrets", ownSecrets: { names: ["ENCRYPTION_KEY"], prefixes: ["PRISMALENS_"] } },
			},
			stored: { ENCRYPTION_KEY: "stored" },
			overrides: { PRISMALENS_DB: "override" },
		}).env;
		expect(env.ENCRYPTION_KEY).toBeUndefined();
		expect(env.PRISMALENS_DB).toBeUndefined();
	});

	it("drops a refuseEnvNames name from a stored value under the allowlist floor", () => {
		const env = plan({
			policy: { ...POLICY, floor: { mode: "allowlist" }, refuseEnvNames: ["ENCRYPTION_KEY"] },
			stored: { ENCRYPTION_KEY: "stored", OTHER: "kept" },
		}).env;
		expect(env.ENCRYPTION_KEY).toBeUndefined();
		expect(env.OTHER).toBe("kept");
	});

	it("drops an own secret whatever its case, as Windows would read it", () => {
		const env = plan({
			policy: {
				...POLICY,
				floor: { mode: "inherit-minus-own-secrets", ownSecrets: { names: ["ENCRYPTION_KEY"], prefixes: ["PRISMALENS_"] } },
			},
			hostEnv: { ...HOST, prismalens_auth_secret: "host", encryption_key: "host" },
			stored: { Prismalens_Db: "stored" },
		}).env;
		expect(env.prismalens_auth_secret).toBeUndefined();
		expect(env.encryption_key).toBeUndefined();
		expect(env.Prismalens_Db).toBeUndefined();
	});

	it("on Windows a stored value replaces a host variable spelled in another case", () => {
		const platform = Object.getOwnPropertyDescriptor(process, "platform");
		Object.defineProperty(process, "platform", { value: "win32" });
		try {
			const env = plan({
				policy: { ...POLICY, floor: { mode: "inherit-minus-own-secrets", ownSecrets: {} } },
				hostEnv: { ...HOST, my_var: "from-host" },
				stored: { MY_VAR: "from-settings" },
			}).env;
			expect(env.my_var).toBeUndefined();
			expect(env.MY_VAR).toBe("from-settings");
		} finally {
			if (platform) Object.defineProperty(process, "platform", platform);
		}
	});

	it("refuses a userSetup with no rows yet", () => {
		expect(() => plan({ policy: { ...POLICY, userSetup: "supplied" } })).toThrow(/user-setup|supplied/);
	});
});

describe('github: "exclude"', () => {
	it("leaves no GitHub token, an empty GH_CONFIG_DIR and an empty credential.helper in the child", () => {
		const runDir = mkdtempSync(join(tmpdir(), "ah-launch-"));
		dirs.push(runDir);
		const p = plan({
			runDir,
			cwd: runDir,
			policy: {
				...POLICY,
				github: "exclude",
				floor: { mode: "inherit-minus-own-secrets", ownSecrets: {} },
			},
			hostEnv: { ...process.env, ...HOST, PATH: process.env.PATH },
			stored: { GH_TOKEN: "stored-ghp" },
		});
		for (const key of GITHUB_TOKEN_VARS) expect(p.env[key], key).toBeUndefined();
		writeLaunchFiles(p);
		expect(p.env.GH_CONFIG_DIR).toBe(join(runDir, "gh"));
		expect(readdirSync(p.env.GH_CONFIG_DIR as string)).toEqual([]);
		// `--get` prints the last value and exits 1 when there is none, so "" means set to empty.
		const helper = execFileSync("git", ["config", "--get", "credential.helper"], {
			cwd: runDir,
			env: p.env,
			encoding: "utf8",
		});
		expect(helper.trim().split(/\r?\n/).at(-1)).toBe("");
	});
});

describe('github: "exclude" on a case-insensitive environment (#1020, CP4 OBJ-012, OBJ-013)', () => {
	const exclude = (hostEnv: Record<string, string | undefined>, github: "include" | "exclude" = "exclude") =>
		plan({
			runDir: "/run",
			policy: { ...POLICY, github, floor: { mode: "inherit-minus-own-secrets", ownSecrets: {} } },
			hostEnv,
		}).env;

	it("drops a token whatever the letter case of its name", () => {
		const env = exclude({ PATH: "/bin", gh_token: "ghp_low", Github_Token: "ghs_mixed", gh_Enterprise_Token: "ghe" });
		expect(Object.keys(env).map((k) => k.toUpperCase())).not.toEqual(
			expect.arrayContaining(["GH_TOKEN"]),
		);
		expect(JSON.stringify(env)).not.toMatch(/ghp_low|ghs_mixed|"ghe"/);
	});

	it("drops the SSH agent and askpass programs too; include keeps them", () => {
		const host = { PATH: "/bin", SSH_AUTH_SOCK: "/tmp/agent.sock", ssh_askpass: "/usr/bin/ask", GIT_ASKPASS: "/usr/bin/gask" };
		const env = exclude(host);
		for (const k of Object.keys(env)) expect(["SSH_AUTH_SOCK", "SSH_ASKPASS", "GIT_ASKPASS"]).not.toContain(k.toUpperCase());
		const kept = exclude(host, "include");
		expect(kept.SSH_AUTH_SOCK).toBe("/tmp/agent.sock");
		expect(kept.GIT_ASKPASS).toBe("/usr/bin/gask");
	});
});

describe("launch files", () => {
	it("puts OpenCode's config inline with the level's overlay, and leaves the user's OPENCODE_CONFIG_DIR alone", () => {
		const runDir = mkdtempSync(join(tmpdir(), "ah-launch-"));
		dirs.push(runDir);
		const p = planLaunch({
			agent: "opencode",
			level: "auto-edits",
			policy: { ...POLICY, floor: { mode: "inherit-minus-own-secrets", ownSecrets: {} } },
			launch: { command: "opencode" },
			cwd: "/w",
			runDir,
			hostEnv: { ...HOST, OPENCODE_CONFIG_DIR: "/home/u/my-opencode" },
		});
		writeLaunchFiles(p);
		expect(existsSync(join(runDir, "config", "opencode.json"))).toBe(false);
		const json = JSON.parse(p.env.OPENCODE_CONFIG_CONTENT as string);
		expect(json.share).toBe("disabled");
		expect(json.permission.edit).toEqual({ "*": "allow" });
		expect(p.env.OPENCODE_CONFIG_DIR).toBe("/home/u/my-opencode");
		expect(p.args).toEqual(["acp"]);
		expect(p.cwd).toBe("/w");
		expect(p.level?.mode).toEqual({ id: "build", name: "Build" });
	});

	it("merges the run's OpenCode config over an OPENCODE_CONFIG_CONTENT the user set, and refuses one that isn't a JSON object", () => {
		const user = { model: "mine/m", permission: { bash: { "rm *": "deny" } } };
		const p = plan({
			agent: "opencode",
			level: "supervised",
			launch: { command: "opencode" },
			stored: { OPENCODE_CONFIG_CONTENT: JSON.stringify(user) },
		});
		const json = JSON.parse(p.env.OPENCODE_CONFIG_CONTENT as string);
		expect(json.model).toBe("mine/m");
		expect(json.agent.build.permission.bash["rm *"]).toBe("deny");
		expect(json.share).toBe("disabled");
		expect(() =>
			plan({ agent: "opencode", launch: { command: "opencode" }, stored: { OPENCODE_CONFIG_CONTENT: "{ model: x" } }),
		).toThrow(/OPENCODE_CONFIG_CONTENT/);
	});

	it("lists the user's inline deny rules after the level's catch-all at full-access", () => {
		const user = { permission: { bash: { "rm *": "deny" } }, agent: { build: { permission: { bash: { "git push *": "deny" } } } } };
		const p = plan({
			agent: "opencode",
			level: "full-access",
			launch: { command: "opencode" },
			stored: { OPENCODE_CONFIG_CONTENT: JSON.stringify(user) },
		});
		const json = JSON.parse(p.env.OPENCODE_CONFIG_CONTENT as string);
		expect(Object.entries(json.agent.explore.permission.bash)).toEqual([
			["*", "allow"],
			["rm *", "deny"],
		]);
		expect(Object.entries(json.agent.build.permission.bash)).toEqual([
			["rm *", "deny"],
			["git push *", "deny"],
		]);
	});

	it("writes the gateway run file owner-only and points deepagents at it (#848)", () => {
		const runDir = mkdtempSync(join(tmpdir(), "ah-launch-"));
		dirs.push(runDir);
		const gateway = { url: "http://127.0.0.1:9/mcp", token: "bearer-tok", name: "prismalens-run1" };
		const p = planLaunch({
			agent: "deepagents",
			level: "supervised",
			policy: POLICY,
			launch: { command: "dcode" },
			cwd: "/w",
			runDir,
			hostEnv: HOST,
			gateway,
		});
		const file = join(runDir, "config", GATEWAY_RUN_FILE);
		expect(p.args).toEqual(["--acp", "--mcp-config", file]);
		writeLaunchFiles(p);
		expect(JSON.parse(readFileSync(file, "utf8"))).toEqual({
			mcpServers: {
				"prismalens-run1": {
					type: "http",
					url: gateway.url,
					headers: { Authorization: "Bearer bearer-tok" },
				},
			},
		});
		if (process.platform !== "win32") {
			expect(statSync(file).mode & 0o777).toBe(0o600);
			expect(statSync(join(runDir, "config")).mode & 0o777).toBe(0o700);
		}
	});

	it("gives the gateway only to a row with gatewayDelivery", () => {
		const gateway = { url: "http://127.0.0.1:9/mcp", token: "t", name: "n" };
		const p = plan({ gateway });
		expect(p.runEnv.gateway).toBeUndefined();
		expect(Object.keys(p.files)).toEqual([]);
	});
});

// Node refuses to spawn a .cmd without a shell only on Windows; elsewhere npm writes no .cmd shim.
describe.skipIf(process.platform !== "win32")("a companion behind an npm .cmd shim (#1013)", () => {
	it("hands the adapter the .exe the shim runs, which spawns without a shell", () => {
		const dir = mkdtempSync(join(tmpdir(), "ah-shim-"));
		try {
			const exe = join(dir, "node_modules", "@anthropic-ai", "claude-code", "bin", "claude.exe");
			mkdirSync(dirname(exe), { recursive: true });
			copyFileSync(process.execPath, exe);
			const shim = join(dir, "claude.cmd");
			writeFileSync(
				shim,
				'@ECHO off\r\nGOTO start\r\n:find_dp0\r\nSET dp0=%~dp0\r\nEXIT /b\r\n:start\r\nSETLOCAL\r\nCALL :find_dp0\r\n"%dp0%\\node_modules\\@anthropic-ai\\claude-code\\bin\\claude.exe"   %*\r\n',
			);
			expect(spawnSync(shim, ["-e", ""]).error?.message).toMatch(/EINVAL/);
			const p = planLaunch({
				agent: "claude-code",
				policy: POLICY,
				launch: { command: "claude-agent-acp", shipped: true, companionPath: shim },
				cwd: dir,
				runDir: join(dir, "run"),
				hostEnv: HOST,
			});
			expect(p.env.CLAUDE_CODE_EXECUTABLE).toBe(exe);
			const ran = spawnSync(p.env.CLAUDE_CODE_EXECUTABLE as string, ["-e", "process.stdout.write('ok')"], {
				encoding: "utf8",
			});
			expect(ran.error).toBeUndefined();
			expect(ran.stdout).toBe("ok");
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});

describe("planLaunch sub-agent limits (#1024 spec B)", () => {
	it("Given depth and concurrency, Then Claude Code gets its two env keys and nothing is set when they are unset", () => {
		const env = plan({ subagents: { depth: 2, concurrency: 3 } }).env;
		expect(env.CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH).toBe("2");
		expect(env.CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS).toBe("3");
		const unset = plan().env;
		expect(unset.CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH).toBeUndefined();
		expect(unset.CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS).toBeUndefined();
	});

	it("Given a CODEX_CONFIG the user stored, Then Codex's agents keys merge into it", () => {
		const env = plan({
			agent: "codex",
			launch: { command: "codex-acp" },
			stored: { CODEX_CONFIG: JSON.stringify({ model: "gpt-x", agents: { other: 1 } }) },
			subagents: { depth: 1, concurrency: 4 },
		}).env;
		expect(JSON.parse(env.CODEX_CONFIG ?? "{}")).toEqual({
			model: "gpt-x",
			agents: { other: 1, max_depth: 1, max_threads: 4 },
		});
	});

	it("Given depth and concurrency, Then OpenCode gets experimental.subagent_depth in its inline config and no concurrency key", () => {
		const p = plan({
			agent: "opencode",
			launch: { command: "opencode" },
			subagents: { depth: 2, concurrency: 5 },
		});
		const config = JSON.parse(p.env.OPENCODE_CONFIG_CONTENT ?? "{}");
		expect(config.experimental).toMatchObject({ subagent_depth: 2, continue_loop_on_deny: true });
		expect(JSON.stringify(config)).not.toContain("5");
	});

	it("Given an agent with no keys, Then the limits change nothing", () => {
		const base = plan({ agent: "gemini", launch: { command: "gemini" } });
		const limited = plan({
			agent: "gemini",
			launch: { command: "gemini" },
			subagents: { depth: 2, concurrency: 2 },
		});
		expect(limited.env).toEqual(base.env);
		expect(limited.files).toEqual(base.files);
	});
});

describe("planLaunch isolation (#1180 R1, §3.4)", () => {
	const host = (files: Record<string, string> = {}) => ({
		platform: "linux",
		home: "/home/u",
		read: (path: string) => files[path] ?? null,
	});
	const isolated = (
		agent: PlanLaunchInput["agent"],
		use: Isolation,
		over: Partial<PlanLaunchInput> = {},
	) =>
		plan({
			agent,
			level: undefined,
			launch: { command: agent },
			isolation: [{ use, mcp: ["user-srv", "repo srv"] }],
			isolationHost: host(),
			...over,
		});
	const options = (p: { sessionMeta?: Record<string, unknown> }) =>
		(p.sessionMeta?.claudeCode as { options: Record<string, unknown> }).options;

	it("Claude Code check: strictMcpConfig and disableAllHooks merged into its options, and claude.ai connectors off", () => {
		const p = isolated("claude-code", claudeProbeIsolation);
		expect(p.sessionMeta).toEqual({
			claudeCode: {
				options: {
					settingSources: ["user", "project", "local"],
					disallowedTools: ["EnterPlanMode", "ExitPlanMode"],
					perTaskStopAffordance: false,
					strictMcpConfig: true,
					settings: { disableAllHooks: true },
				},
			},
		});
		expect(p.env.ENABLE_CLAUDEAI_MCP_SERVERS).toBe("false");
		expect(p.args).toEqual([]);
	});

	it("Claude Code check: a managed-mcp.json with mcpServers leaves strictMcpConfig out; one that does not parse keeps it", () => {
		const managed = "/etc/claude-code/managed-mcp.json";
		const valid = isolated("claude-code", claudeProbeIsolation, {
			isolationHost: host({ [managed]: '{"mcpServers":{"corp":{}}}' }),
		});
		expect("strictMcpConfig" in options(valid)).toBe(false);
		expect(options(valid).settings).toEqual({ disableAllHooks: true });
		const broken = isolated("claude-code", claudeProbeIsolation, {
			isolationHost: host({ [managed]: "{not json" }),
		});
		expect(options(broken).strictMcpConfig).toBe(true);
	});

	it("Codex check: CODEX_CONFIG holds hooks and plugins off and each found server off, merged into the user's own", () => {
		const p = isolated("codex", codexProbeIsolation, {
			stored: { CODEX_CONFIG: '{"model":"gpt-x","features":{"web":true}}' },
		});
		expect(JSON.parse(p.env.CODEX_CONFIG as string)).toEqual({
			model: "gpt-x",
			features: { web: true, hooks: false, plugins: false },
			mcp_servers: {
				"user-srv": { enabled: false },
				"repo srv": { enabled: false },
			},
		});
	});

	it("an empty mcp list turns no server off by name and keeps hooks and plugins off", () => {
		const p = isolated("codex", codexProbeIsolation, {
			isolation: [{ use: codexProbeIsolation, mcp: [] }],
		});
		expect(JSON.parse(p.env.CODEX_CONFIG as string)).toEqual({
			features: { hooks: false, plugins: false },
		});
	});

	it("OpenCode check on 1.19.6: OPENCODE_PURE and each found server off in its inline config", () => {
		const p = isolated("opencode", opencodeProbeIsolation, {
			agentVersion: "1.19.6",
		});
		expect(p.env.OPENCODE_PURE).toBe("1");
		expect(JSON.parse(p.env.OPENCODE_CONFIG_CONTENT as string)).toEqual({
			$schema: "https://opencode.ai/config.json",
			experimental: { continue_loop_on_deny: true },
			share: "disabled",
			mcp: { "user-srv": { enabled: false }, "repo srv": { enabled: false } },
		});
	});

	it("OpenCode check on 2.4.1, which has no plugin switch, throws isolation-unavailable", () => {
		let thrown: unknown;
		try {
			isolated("opencode", opencodeProbeIsolation, { agentVersion: "2.4.1" });
		} catch (e) {
			thrown = e;
		}
		expect(thrown).toEqual(
			new AgentHostError(
				"isolation-unavailable",
				"OpenCode 2.4.1 has no switch for its plugins",
			),
		);
		expect((thrown as AgentHostError).code).toBe("isolation-unavailable");
	});

	it("Gemini check: workspace untrusted, and a run copy of the system settings with hooks off that keeps the admin's keys", () => {
		const p = isolated("gemini", geminiProbeIsolation, {
			isolationHost: host({
				"/etc/gemini-cli/settings.json":
					'{"security":{"auth":{"enforcedType":"oauth"}},"hooksConfig":{"enabled":true}}',
			}),
		});
		const copy = join("/run", "gemini-system-settings.json");
		expect(p.env.GEMINI_CLI_TRUST_WORKSPACE).toBe("false");
		expect(p.env.GEMINI_CLI_SYSTEM_SETTINGS_PATH).toBe(copy);
		expect(p.env.GEMINI_CLI_SYSTEM_DEFAULTS_PATH).toBe(
			"/etc/gemini-cli/system-defaults.json",
		);
		expect(JSON.parse(p.files[copy] as string)).toEqual({
			security: { auth: { enforcedType: "oauth" } },
			hooksConfig: { enabled: false },
		});
	});

	it("Gemini check keeps the defaults file the user pointed at, and an unreadable system file throws isolation-unavailable", () => {
		const p = isolated("gemini", geminiProbeIsolation, {
			stored: { GEMINI_CLI_SYSTEM_DEFAULTS_PATH: "/opt/defaults.json" },
		});
		expect(p.env.GEMINI_CLI_SYSTEM_DEFAULTS_PATH).toBe("/opt/defaults.json");
		expect(() =>
			isolated("gemini", geminiProbeIsolation, {
				isolationHost: {
					...host(),
					read: () => {
						throw new Error("EACCES");
					},
				},
			}),
		).toThrow("Gemini CLI's system settings file could not be read");
	});

	it("Gemini clean: no extensions, only PrismaLens's servers, hooks off, trust left alone", () => {
		const p = isolated("gemini", geminiCleanIsolation, {
			gateway: { url: "http://127.0.0.1:1/mcp", token: "t", name: "pl-run" },
		});
		expect(p.args).toEqual([
			"--acp",
			"-e",
			"none",
			"--allowed-mcp-server-names",
			"prismalens",
		]);
		expect(p.env.GEMINI_CLI_TRUST_WORKSPACE).toBeUndefined();
		expect(JSON.parse(p.files[join("/run", "gemini-system-settings.json")] as string)).toEqual({
			hooksConfig: { enabled: false },
		});
	});

	it("Claude Code clean: user settings unread, hooks and plugins off, strict MCP", () => {
		const p = isolated("claude-code", claudeCleanIsolation);
		expect(p.sessionMeta).toEqual({
			claudeCode: {
				options: {
					settingSources: ["project", "local"],
					disallowedTools: ["EnterPlanMode", "ExitPlanMode"],
					perTaskStopAffordance: false,
					strictMcpConfig: true,
					settings: { disableAllHooks: true, enabledPlugins: {} },
				},
			},
		});
	});

	const signInSettings = (text: string) =>
		host({ [join("/c", "settings.json").replaceAll("\\", "/")]: text });

	it.each([
		'{"apiKeyHelper":"get-key"}',
		'{"awsCredentialExport":"x"}',
		'{"env":{"ANTHROPIC_AUTH_TOKEN":"x"}}',
		'{"env":{"CLAUDE_CODE_USE_BEDROCK":"1"}}',
	])("Claude Code clean is unavailable when the user's settings carry sign-in: %s", (text) => {
		expect(() =>
			isolated("claude-code", claudeCleanIsolation, {
				hostEnv: { ...HOST, CLAUDE_CONFIG_DIR: "/c" },
				isolationHost: signInSettings(text),
			}),
		).toThrow("Your Claude settings carry sign-in");
	});

	it("Claude Code clean holds when the user's settings carry hooks but no sign-in", () => {
		const hooksOnly = isolated("claude-code", claudeCleanIsolation, {
			hostEnv: { ...HOST, CLAUDE_CONFIG_DIR: "/c" },
			isolationHost: signInSettings('{"hooks":{}}'),
		});
		expect(options(hooksOnly).settingSources).toEqual(["project", "local"]);
	});

	const homes = {
		CLAUDE_CONFIG_DIR: "/c",
		CODEX_HOME: "/x",
		GEMINI_CLI_HOME: "/g",
		XDG_DATA_HOME: "/d",
		HOME: "/home/u",
	};
	it.each([
		["claude-code", claudeCleanIsolation, ["ENABLE_CLAUDEAI_MCP_SERVERS"]],
		["codex", codexCleanIsolation, ["CODEX_CONFIG"]],
		[
			"opencode",
			opencodeCleanIsolation,
			["OPENCODE_CONFIG_CONTENT", "OPENCODE_DISABLE_CLAUDE_CODE", "OPENCODE_PURE"],
		],
		[
			"gemini",
			geminiCleanIsolation,
			["GEMINI_CLI_SYSTEM_DEFAULTS_PATH", "GEMINI_CLI_SYSTEM_SETTINGS_PATH"],
		],
	] as const)(
		"%s clean changes only its listed env keys, keeps the config and data folders and adds no sign-in key",
		(agent, use, listed) => {
			const base = {
				agent,
				level: undefined,
				launch: { command: agent },
				agentVersion: "1.19.6",
				hostEnv: { ...HOST, ...homes },
				isolationHost: host(),
			};
			const own = plan(base);
			const p = plan({ ...base, isolation: [{ use, mcp: ["srv"] }] });
			const changed = Object.keys({ ...own.env, ...p.env }).filter(
				(k) => own.env[k] !== p.env[k],
			);
			expect(changed.sort()).toEqual([...listed]);
			expect(
				Object.fromEntries(Object.keys(homes).map((k) => [k, p.env[k]])),
			).toEqual(homes);
		},
	);
});
