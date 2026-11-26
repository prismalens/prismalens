// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type LimitReadDeps, readLimits } from "./limits-read.js";

const here = dirname(fileURLToPath(import.meta.url));
const FAKE = join(here, "__fixtures__", "fake-codex-app-server.mjs");
const AT = new Date("2026-11-26T10:00:00.000Z");

let dir: string;
beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), "pl-limits-test-"));
});
afterEach(() => {
	rmSync(dir, { recursive: true, force: true });
});

function codexPlan(mode: string, extra: Record<string, string> = {}) {
	return {
		command: process.execPath,
		args: [FAKE],
		cwd: dir,
		env: {
			PATH: process.env.PATH ?? "",
			SystemRoot: process.env.SystemRoot ?? "",
			FAKE_CODEX_MODE: mode,
			CODEX_HOME: join(dir, "codex-home"),
			...extra,
		},
	};
}

describe("readLimits through codex app-server (#1180)", () => {
	it("reads the codex bucket's two positions and the account's email", async () => {
		const read = await readLimits("codex", codexPlan("ok"), { now: () => AT });
		expect(read).toEqual({
			account: "dev@example.test",
			at: AT.toISOString(),
			windows: [
				{
					key: "codex:primary",
					window: "session",
					type: null,
					usedPercent: 42,
					resetsAt: new Date(1_800_000_000 * 1000).toISOString(),
					status: null,
				},
				{
					key: "codex:secondary",
					window: "weekly",
					type: null,
					usedPercent: 7,
					resetsAt: new Date(1_800_500_000 * 1000).toISOString(),
					status: null,
				},
			],
		});
	});

	it("keeps a model bucket apart from the codex bucket, as a model window named by its id", async () => {
		const read = await readLimits("codex", codexPlan("buckets"));
		expect(read?.windows.map((w) => [w.key, w.window, w.type, w.usedPercent])).toEqual([
			["codex:primary", "session", null, 42],
			["codex:secondary", "weekly", null, 7],
			["gpt-6.2-sol-mini:primary", "model", "gpt-6.2-sol-mini", 90],
		]);
	});

	it("reads a free plan's primary window with no duration as monthly", async () => {
		const read = await readLimits("codex", codexPlan("free"));
		expect(read?.windows).toEqual([
			{
				key: "codex:primary",
				window: "monthly",
				type: null,
				usedPercent: 100,
				resetsAt: new Date(1_800_000_000 * 1000).toISOString(),
				status: null,
			},
		]);
	});

	it("starts app-server with hooks off and each MCP server of the user's config.toml off", async () => {
		const home = join(dir, "codex-home");
		mkdirSync(home);
		writeFileSync(
			join(home, "config.toml"),
			'[mcp_servers.docs]\ncommand = "docs-mcp"\n\n[mcp_servers."my.tools"]\ncommand = "t"\n',
		);
		const out = join(dir, "args.json");
		await readLimits("codex", codexPlan("ok", { FAKE_CODEX_ARGS: out }));
		expect(JSON.parse(readFileSync(out, "utf8"))).toEqual([
			"app-server",
			"-c",
			"features.hooks=false",
			"-c",
			"mcp_servers.docs.enabled=false",
			"-c",
			'mcp_servers."my.tools".enabled=false',
		]);
	});

	it("returns null when app-server does not answer within the budget", async () => {
		const started = Date.now();
		const read = await readLimits("codex", codexPlan("hang"), { budgetMs: 400 });
		expect(read).toBeNull();
		expect(Date.now() - started).toBeLessThan(5_000);
	});

	it("returns null when the rate-limit read answers with an error", async () => {
		expect(await readLimits("codex", codexPlan("error"))).toBeNull();
	});
});

type FakeQuery = NonNullable<LimitReadDeps["query"]>;

function fakeQuery(answer: {
	usage?: unknown;
	noUsage?: boolean;
	account?: Record<string, string>;
}) {
	const calls: { options: unknown; usageOpts: unknown[]; closed: boolean } = {
		options: null,
		usageOpts: [],
		closed: false,
	};
	const query = vi.fn(((params) => {
		calls.options = params.options;
		return {
			accountInfo: async () => answer.account ?? { email: "me@example.test" },
			close: () => {
				calls.closed = true;
			},
			...(answer.noUsage
				? {}
				: {
						usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET: async (
							opts: unknown,
						) => {
							calls.usageOpts.push(opts);
							return answer.usage;
						},
					}),
		};
	}) as FakeQuery);
	return { query, calls };
}

const claudePlan = () => ({
	command: "/opt/bin/claude",
	cwd: dir,
	env: { CLAUDE_CONFIG_DIR: join(dir, "claude"), HOME: dir },
});

const claudeDeps = (query: FakeQuery): LimitReadDeps => ({
	query,
	now: () => AT,
	home: dir,
	managedSettingsPath: join(dir, "managed-settings.json"),
});

describe("readLimits through the Claude Agent SDK (#1180)", () => {
	it("maps rate_limits and closes the session, started with hooks and MCP servers off", async () => {
		const { query, calls } = fakeQuery({
			usage: {
				rate_limits_available: true,
				rate_limits: {
					five_hour: { utilization: 31.5, resets_at: "2026-11-26T12:00:00Z" },
					seven_day: { utilization: 64, resets_at: "2026-11-30T00:00:00Z" },
					seven_day_opus: null,
					model_scoped: [
						{ display_name: "Fable", utilization: 12, resets_at: null },
					],
					extra_usage: {
						is_enabled: true,
						monthly_limit: 2000,
						used_credits: 500,
						utilization: null,
					},
				},
			},
		});
		const read = await readLimits("claude-code", claudePlan(), claudeDeps(query));
		expect(read).toEqual({
			account: "me@example.test",
			at: AT.toISOString(),
			windows: [
				{
					key: "five_hour:session",
					window: "session",
					type: "five_hour",
					usedPercent: 31.5,
					resetsAt: "2026-11-26T12:00:00.000Z",
					status: null,
				},
				{
					key: "seven_day:weekly",
					window: "weekly",
					type: "seven_day",
					usedPercent: 64,
					resetsAt: "2026-11-30T00:00:00.000Z",
					status: null,
				},
				{
					key: "seven_day_fable:model",
					window: "model",
					type: "seven_day_fable",
					usedPercent: 12,
					resetsAt: null,
					status: null,
				},
				{
					key: "monthly_spend:monthly",
					window: "monthly",
					type: "monthly_spend",
					usedPercent: 25,
					resetsAt: null,
					status: null,
				},
			],
		});
		expect(calls.usageOpts).toEqual([{ skipBehaviors: true }]);
		expect(calls.closed).toBe(true);
		expect(calls.options).toEqual({
			pathToClaudeCodeExecutable: "/opt/bin/claude",
			cwd: dir,
			env: {
				CLAUDE_CONFIG_DIR: join(dir, "claude"),
				HOME: dir,
				ENABLE_CLAUDEAI_MCP_SERVERS: "false",
			},
			settingSources: ["user"],
			strictMcpConfig: true,
			mcpServers: {},
			settings: { disableAllHooks: true },
		});
	});

	it("returns null when the SDK has no usage method", async () => {
		const { query, calls } = fakeQuery({ noUsage: true });
		expect(
			await readLimits("claude-code", claudePlan(), claudeDeps(query)),
		).toBeNull();
		expect(calls.closed).toBe(true);
	});

	it("returns null when plan limits do not apply (rate_limits null)", async () => {
		const { query } = fakeQuery({
			usage: { rate_limits_available: false, rate_limits: null },
		});
		expect(
			await readLimits("claude-code", claudePlan(), claudeDeps(query)),
		).toBeNull();
	});

	it("starts no session when the planned config dir's settings set an apiKeyHelper", async () => {
		mkdirSync(join(dir, "claude"));
		writeFileSync(
			join(dir, "claude", "settings.json"),
			JSON.stringify({ apiKeyHelper: "/usr/local/bin/key" }),
		);
		const { query } = fakeQuery({ usage: { rate_limits_available: true } });
		expect(
			await readLimits("claude-code", claudePlan(), claudeDeps(query)),
		).toBeNull();
		expect(query).not.toHaveBeenCalled();
	});

	it("starts no session when the managed settings set an apiKeyHelper", async () => {
		writeFileSync(
			join(dir, "managed-settings.json"),
			JSON.stringify({ apiKeyHelper: "key-helper" }),
		);
		const { query } = fakeQuery({ usage: { rate_limits_available: true } });
		expect(
			await readLimits("claude-code", claudePlan(), claudeDeps(query)),
		).toBeNull();
		expect(query).not.toHaveBeenCalled();
	});
});

describe("readLimits for an agent with no read before a run", () => {
	it("returns null without starting anything", async () => {
		const { query } = fakeQuery({});
		expect(
			await readLimits("opencode", claudePlan(), claudeDeps(query)),
		).toBeNull();
		expect(query).not.toHaveBeenCalled();
	});
});

describe("the Claude Agent SDK pin (#1180)", () => {
	it("is the same exact version in engine and agent-adapters", () => {
		const pin = (pkg: string) =>
			(
				JSON.parse(readFileSync(join(here, pkg), "utf8")) as {
					dependencies: Record<string, string>;
				}
			).dependencies["@anthropic-ai/claude-agent-sdk"];
		expect(pin("../../package.json")).toBe("0.3.328");
		expect(pin("../../../agent-adapters/package.json")).toBe("0.3.328");
	});
});
