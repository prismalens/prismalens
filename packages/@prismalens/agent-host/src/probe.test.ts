// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
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
		timeoutMs: 5_000,
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
		const r = await probe({ FAKE_ACP_MODE: "hang" }, { timeoutMs: 800 });
		expect(r.outcome).toBe("no-answer");
		expect(r.detail).toBe("no answer in 1s");
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
