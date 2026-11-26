// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { setTimeout as realSleep } from "node:timers/promises";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import type { NewSessionResponse } from "@agentclientprotocol/sdk";
import { offeredModes, type ProbeInput, probeAgent } from "./probe.js";

// The engine's fake ACP agent, used read-only; FAKE_ACP_MODE picks its behaviour.
const FAKE = resolve(
	import.meta.dirname,
	"../../engine/src/run/__fixtures__/fake-acp-harness.mjs",
);
const cwd = realpathSync(mkdtempSync(join(tmpdir(), "ah-probe-")));
afterAll(() => rmSync(cwd, { recursive: true, force: true }));

const authHelper = join(cwd, "auth-helper.mjs");
writeFileSync(
	authHelper,
	`import { createInterface } from "node:readline";

const send = (msg) => process.stdout.write(\`\${JSON.stringify(msg)}\\n\`);

createInterface({ input: process.stdin }).on("line", (line) => {
	if (!line.trim()) return;
	const msg = JSON.parse(line);
	if (msg.method === "initialize") {
		send({
			jsonrpc: "2.0",
			id: msg.id,
			result: {
				protocolVersion: 1,
				agentInfo: { name: "fake", version: "0" },
				agentCapabilities: {
					_meta: { authStatus: {} },
					auth: { status: {} },
				},
			},
		});
		if (process.env.AUTH_PUSH) {
			send({
				jsonrpc: "2.0",
				method: "_auth/status_update",
				params: {
					authStatus: JSON.parse(process.env.AUTH_PUSH),
				},
			});
		}
	} else if (msg.method === "session/new") {
		send({
			jsonrpc: "2.0",
			id: msg.id,
			result: { sessionId: "s1" },
		});
	} else if (msg.method === "auth/status") {
		if (process.env.AUTH_STATUS_ERROR) {
			send({
				jsonrpc: "2.0",
				id: msg.id,
				error: { code: -32603, message: "auth status failed" },
			});
			return;
		}
		if (process.env.AUTH_STATUS_RESULT) {
			send({
				jsonrpc: "2.0",
				id: msg.id,
				result: JSON.parse(process.env.AUTH_STATUS_RESULT),
			});
		}
	}
});
`,
);
function probe(env: Record<string, string>, over: Partial<ProbeInput> = {}) {
	return probeAgent({
		agent: "claude-code",
		command: process.execPath,
		args: [FAKE],
		cwd,
		env: { PATH: process.env.PATH ?? "", ...env },
		...over,
	});
}

describe("probeAgent", () => {
	it("answers-acp: reports agentInfo, protocol, modes and each level's mode", async () => {
		const r = await probe({ FAKE_ACP_MODE: "ok", FAKE_PROFILE: "claude" });
		expect(r.outcome).toBe("answers-acp");
		expect(r.agentInfo).toMatchObject({ name: "fake", version: "0" });
		expect(r.protocolVersion).toBe(1);
		expect(r.authRequired).toBe(false);
		expect(r.modes?.current).toBe("default");
		expect(r.modes?.available.map((m) => m.id)).toContain("bypassPermissions");
		expect(r.levels?.auto).toEqual({ mode: "auto", offered: true, runs: "auto" });
	});

	it("reads modes from the `mode` config option and flags a level whose mode is gone", async () => {
		const r = await probe(
			{ FAKE_ACP_MODE: "ok", FAKE_PROFILE: "codex", FAKE_MODELS: "gpt-a,gpt-b" },
			{ agent: "codex" },
		);
		expect(r.outcome).toBe("answers-acp");
		expect(r.modes?.available.map((m) => m.id)).toEqual(["read-only", "agent", "agent-full-access"]);
		expect(r.models).toEqual({
			current: "gpt-a",
			available: [
				{ id: "gpt-a", name: "gpt-a" },
				{ id: "gpt-b", name: "gpt-b" },
			],
		});
		// codex-acp before 2.0 has no workspace-write: auto-edits runs its fallback.
		expect(r.levels?.["auto-edits"]).toEqual({ mode: "workspace-write", offered: true, runs: "read-only" });
		const renamed = await probe(
			{ FAKE_ACP_MODE: "ok", FAKE_MODES: "plan=Plan" },
			{ agent: "codex" },
		);
		expect(renamed.levels?.supervised).toEqual({ mode: "read-only", offered: false, runs: null });
	});

	it("sign-in-needed: session/new answers auth_required, and authenticate is never called", async () => {
		const r = await probe({ FAKE_ACP_MODE: "auth-required" });
		expect(r.outcome).toBe("sign-in-needed");
		expect(r.authRequired).toBe(true);
		expect(r.authMethods).toEqual([{ id: "login", name: "Log in with Fake" }]);
	});

	it("no-answer: a handshake that never comes", async () => {
		const r = await probe({ FAKE_ACP_MODE: "hang" }, { budgets: { initialize: 800 } });
		expect(r.outcome).toBe("no-answer");
		expect(r.detail).toBe("initialize: no answer in 1s");
	});

	it("failed-to-start: an agent that exits, and a binary that is not there", async () => {
		const exits = await probe({ FAKE_ACP_MODE: "unauthenticated" });
		expect(exits.outcome).toBe("failed-to-start");
		expect(exits.detail).toContain("not logged in");
		const missing = await probe({}, { command: join(cwd, "no-such-agent"), args: [] });
		expect(missing.outcome).toBe("failed-to-start");
	});

	it("waits for the sign-in the agent pushes after the handshake, and returns the raw answers", async () => {
		const out = await probe({ FAKE_ACP_MODE: "ok", FAKE_AUTH_STATUS: "none", FAKE_AUTH_DELAY_MS: "300", FAKE_IMAGES: "1" }, { authStatusWaitMs: 3_000 });
		expect(out.outcome).toBe("answers-acp");
		expect(out.authStatus).toBe("none");
		expect(out.raw.initialize?.agentCapabilities?.promptCapabilities?.image).toBe(true);
		expect(out.raw.session?.sessionId).toBeTruthy();
		const silent = await probe({ FAKE_ACP_MODE: "ok", FAKE_AUTH_STATUS: "silent" }, { authStatusWaitMs: 200 });
		expect(silent.authStatus).toBeNull();
	});

	it("reads account details from _auth/status_update push (#1171)", async () => {
		const push = {
			kind: "account",
			label: "Fake Max",
			account: { email: "dev@example.test", plan: "max" },
		};
		const r = await probeAgent({
			agent: "claude-code",
			command: process.execPath,
			args: [authHelper],
			cwd,
			env: { PATH: process.env.PATH ?? "", AUTH_PUSH: JSON.stringify(push) },
			authStatusWaitMs: 1_000,
		});
		expect(r.account).toEqual({
			label: "Fake Max",
			email: "dev@example.test",
			organization: null,
			plan: "max",
		});
	});

	it("queries auth/status when no push arrived and picks active account (#1171)", async () => {
		const payload = {
			state: "authenticated",
			accounts: [
				{ label: "A", active: false },
				{ label: "B", email: "dev@example.test", organization: "Acme", active: true },
			],
		};
		const r = await probeAgent({
			agent: "claude-code",
			command: process.execPath,
			args: [authHelper],
			cwd,
			env: { PATH: process.env.PATH ?? "", AUTH_STATUS_RESULT: JSON.stringify(payload) },
		});
		expect(r.account).toEqual({
			label: "B",
			email: "dev@example.test",
			organization: "Acme",
			plan: null,
		});

		const noLabel = {
			state: "authenticated",
			accounts: [{ active: true, email: "dev@example.test" }],
		};
		const rNoLabel = await probeAgent({
			agent: "claude-code",
			command: process.execPath,
			args: [authHelper],
			cwd,
			env: { PATH: process.env.PATH ?? "", AUTH_STATUS_RESULT: JSON.stringify(noLabel) },
		});
		expect(rNoLabel.account).toBeNull();

		const rError = await probeAgent({
			agent: "claude-code",
			command: process.execPath,
			args: [authHelper],
			cwd,
			env: { PATH: process.env.PATH ?? "", AUTH_STATUS_ERROR: "1" },
		});
		expect(rError.outcome).toBe("answers-acp");
		expect(rError.account).toBeNull();
	});
});

describe("probeAgent on a row that names authenticate methods (#1235)", () => {
	const GATE = resolve(import.meta.dirname, "__fixtures__/method-gate.mjs");
	async function gate(
		env: Record<string, string>,
		budgets?: ProbeInput["budgets"],
		agent: ProbeInput["agent"] = "antigravity",
	) {
		const log = join(cwd, `auth-${Math.random().toString(36).slice(2)}.log`);
		writeFileSync(log, "");
		const r = await probeAgent({
			agent,
			command: process.execPath,
			args: [GATE],
			cwd,
			env: { PATH: process.env.PATH ?? "", LOG: log, ...env },
			...(budgets ? { budgets } : {}),
		});
		return { r, sent: readFileSync(log, "utf8") };
	}

	it("sends the Google sign-in method before session/new and answers ACP", async () => {
		const { r, sent } = await gate({});
		expect([r.outcome, sent]).toEqual(["answers-acp", "oauth-personal\n"]);
	});

	it("sends the API-key method when GEMINI_API_KEY is set", async () => {
		const { r, sent } = await gate({ GEMINI_API_KEY: "k" });
		expect([r.outcome, sent]).toEqual(["answers-acp", "gemini-api-key\n"]);
	});

	it("is signed out when authenticate waits on a browser sign-in past its budget", async () => {
		const { r } = await gate({ GATE: "hang" }, { authenticate: 500 });
		expect([r.outcome, r.authRequired, r.detail]).toEqual([
			"sign-in-needed",
			true,
			"authenticate oauth-personal: no answer in 1s; finish the sign-in the agent opened, then check again",
		]);
	});

	it("sends Grok's unlisted API-key method when XAI_API_KEY is set, and without it no method the agent did not list (#1236)", async () => {
		const keyed = await gate({ XAI_API_KEY: "k" }, undefined, "grok");
		const bare = await gate({}, undefined, "grok");
		expect([keyed.r.outcome, keyed.sent, bare.r.outcome, bare.sent, bare.r.detail]).toEqual([
			"answers-acp",
			"xai.api_key\n",
			"sign-in-needed",
			"",
			"Authentication required",
		]);
	});

	it("reads goose's missing provider as signed out, and the same refusal from another agent as a failed start (#1236)", async () => {
		const goose = await gate({ GATE: "goose" }, undefined, "goose");
		const other = await gate({ GATE: "goose" }, undefined, "kiro");
		expect([goose.r.outcome, goose.r.authRequired, goose.r.detail, other.r.outcome]).toEqual([
			"sign-in-needed",
			true,
			"Failed to resolve provider and model: Configuration value not found: GOOSE_PROVIDER",
			"failed-to-start",
		]);
	});
});

// The default budgets on a fake clock; the agent's own replies still take real time (#1013).
describe("probeAgent budgets: 30 s to initialize, then 60 s for session/new", () => {
	afterEach(() => {
		vi.useRealTimers();
	});
	const fakeClock = () => vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
	// Long enough for the fake agent to start and answer initialize on a loaded runner.
	const initialized = () => realSleep(4_000);

	it("ready: session/new answered after 15 s", async () => {
		fakeClock();
		const running = probe({ FAKE_ACP_MODE: "ok", FAKE_SESSION_DELAY_MS: "6000" });
		await initialized();
		await vi.advanceTimersByTimeAsync(15_000);
		const r = await running;
		expect(r.outcome).toBe("answers-acp");
	});

	it("silent initialize: no answer in 30 s", async () => {
		fakeClock();
		const running = probe({ FAKE_ACP_MODE: "hang" });
		await vi.advanceTimersByTimeAsync(30_000);
		const r = await running;
		expect(r).toMatchObject({ outcome: "no-answer", detail: "initialize: no answer in 30s" });
	});

	it("silent session/new: no answer in 60 s, after initialize answered", async () => {
		fakeClock();
		const running = probe({ FAKE_ACP_MODE: "slow-init" });
		await initialized();
		await vi.advanceTimersByTimeAsync(60_000);
		const r = await running;
		expect(r).toMatchObject({ outcome: "no-answer", detail: "session/new: no answer in 60s" });
		expect(r.agentInfo?.name).toBe("fake");
	});
});

describe("probeAgent: sign-in-needed only on an auth signal (#1013)", () => {
	const exits = (stderr: string) => probe({ FAKE_ACP_MODE: "exit-stderr", FAKE_STDERR: stderr });

	it("an agent that exits with ACP's auth error", async () => {
		const r = await exits('Error: {"code":-32000,"message":"Authentication required"}');
		expect(r).toMatchObject({ outcome: "sign-in-needed", authRequired: true });
	});

	it("an agent that exits naming a missing provider key", async () => {
		const r = await exits("Internal error: CODEX_API_KEY or OPENAI_API_KEY is not set");
		expect(r).toMatchObject({ outcome: "sign-in-needed", authRequired: true });
		expect(r.detail).toContain("CODEX_API_KEY");
	});

	it("deepagents' no-credentials exit is a sign-in", async () => {
		const r = await exits(
			"No credentials configured. Please set one of: ANTHROPIC_API_KEY, OPENAI_API_KEY",
		);
		expect(r.outcome).toBe("sign-in-needed");
	});

	it("a key that is set, beside some other gap, failed to start", async () => {
		for (const stderr of [
			"OPENAI_API_KEY is set; required config property model is missing",
			"Error: required config property model is missing (OPENAI_API_KEY present)",
			"env AWS_SECRET_ACCESS_KEY=set ANTHROPIC_API_KEY=set",
			"ERROR Unrecognized flag: --dir in command opencode acp. Set OPENAI_API_KEY",
			"ANTHROPIC_API_KEY required\nerror: unknown option '--foo'",
		])
			expect((await exits(stderr)).outcome, stderr).toBe("failed-to-start");
	});

	it("a fatal launch error past the 2 KB tail still wins over later key guidance", async () => {
		const help = "  --some-option   does a thing\n".repeat(170);
		const r = await exits(`error: unknown option '--foo'\n${help}Set OPENAI_API_KEY`);
		expect(r.outcome).toBe("failed-to-start");
		expect(r.detail).toMatch(/^error: unknown option '--foo' … /);
		const split = await probe({
			FAKE_ACP_MODE: "exit-stderr",
			FAKE_STDERR_PARTS: JSON.stringify(["error: unkn", `own option '--foo'\n${help}`, "Set OPENAI_API_KEY\n"]),
		});
		expect(split.outcome).toBe("failed-to-start");
	});

	it("an agent that exits on an unrecognized flag failed to start", async () => {
		const r = await exits("ERROR Unrecognized flag: --dir in command opencode acp");
		expect(r.outcome).toBe("failed-to-start");
		expect(r.detail).toContain("Unrecognized flag");
	});
});

describe("offeredModes: ACP's order, config option first (#1101)", () => {
	const modes = {
		currentModeId: "default",
		availableModes: [{ id: "default", name: "Default" }],
	};
	const option = {
		id: "mode",
		name: "Mode",
		category: "mode",
		type: "select",
		currentValue: "plan",
		options: [
			{ value: "plan", name: "Plan" },
			{
				group: "edits",
				name: "Edits",
				options: [{ value: "acceptEdits", name: "Accept edits" }],
			},
		],
	};

	it("reads the `mode` config option, flattening its groups, when the mode list is also present", () => {
		const res = { sessionId: "s", modes, configOptions: [option] } as unknown as NewSessionResponse;
		expect(offeredModes(res)).toEqual({
			current: "plan",
			available: [
				{ id: "plan", name: "Plan" },
				{ id: "acceptEdits", name: "Accept edits" },
			],
		});
	});

	it("falls back to the mode list when no config option has category `mode`", () => {
		const res = {
			sessionId: "s",
			modes,
			configOptions: [{ ...option, category: "model" }],
		} as unknown as NewSessionResponse;
		expect(offeredModes(res)).toEqual({
			current: "default",
			available: [{ id: "default", name: "Default" }],
		});
	});

	it("returns null when the agent offers neither", () => {
		expect(offeredModes({ sessionId: "s" } as unknown as NewSessionResponse)).toBeNull();
	});
});
