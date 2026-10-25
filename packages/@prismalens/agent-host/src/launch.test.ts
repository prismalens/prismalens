// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { AgentHostError } from "./errors.js";
import { GATEWAY_RUN_FILE } from "./registry/index.js";
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

describe("launch files", () => {
	it("writes the row's config with the level's overlay merged in", () => {
		const runDir = mkdtempSync(join(tmpdir(), "ah-launch-"));
		dirs.push(runDir);
		const p = planLaunch({
			agent: "opencode",
			level: "auto-edits",
			policy: POLICY,
			launch: { command: "opencode" },
			cwd: "/w",
			runDir,
			hostEnv: HOST,
		});
		writeLaunchFiles(p);
		const file = join(runDir, "config", "opencode.json");
		expect(existsSync(file)).toBe(true);
		const json = JSON.parse(readFileSync(file, "utf8"));
		expect(json.share).toBe("disabled");
		expect(json.permission.edit).toEqual({ "*": "allow" });
		expect(p.env.OPENCODE_CONFIG_DIR).toBe(join(runDir, "config"));
		expect(p.args).toEqual(["acp", "--cwd", "/w"]);
		expect(p.level?.mode).toEqual({ id: "build", name: "Build" });
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
