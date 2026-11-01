// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { setTimeout as realSleep } from "node:timers/promises";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { type ProbeInput, probeAgent } from "./probe.js";

// The engine's fake ACP agent, used read-only; FAKE_ACP_MODE picks its behaviour.
const FAKE = resolve(
	import.meta.dirname,
	"../../engine/src/run/__fixtures__/fake-acp-harness.mjs",
);
const cwd = realpathSync(mkdtempSync(join(tmpdir(), "ah-probe-")));
afterAll(() => rmSync(cwd, { recursive: true, force: true }));

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
		])
			expect((await exits(stderr)).outcome, stderr).toBe("failed-to-start");
	});

	it("an agent that exits on an unrecognized flag failed to start", async () => {
		const r = await exits("ERROR Unrecognized flag: --dir in command opencode acp");
		expect(r.outcome).toBe("failed-to-start");
		expect(r.detail).toContain("Unrecognized flag");
	});
});
