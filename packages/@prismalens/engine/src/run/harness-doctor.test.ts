// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AcpSession } from "../runner/acp-client.js";
import { classify, probeHarness } from "./harness-doctor.js";

afterEach(() => {
	vi.unstubAllEnvs();
});

const FAKE = join(
	dirname(fileURLToPath(import.meta.url)),
	"__fixtures__",
	"fake-acp-harness.mjs",
);

function descriptor(mode: string, binary = process.execPath) {
	return {
		binary,
		acpArgs: () => [FAKE],
		acpEnv: () => ({ FAKE_ACP_MODE: mode }),
		configFiles: () => ({}),
	};
}

describe("probeHarness", () => {
	it('says "answers ACP", never "ready", after initialize + session/new', async () => {
		const result = await probeHarness("opencode", {
			descriptor: descriptor("ok"),
		});
		expect(result).toEqual({
			id: "opencode",
			outcome: "answers-acp",
			detail: "answers ACP, fake 0",
			hard: false,
			// What it reported of itself, for the picker (R4.2, R4.3): nothing here.
			servedModel: null,
			effort: null,
			modes: null,
			efforts: null,
			images: false,
			sandbox: { "agent-default": { state: "none", reason: "OpenCode has no sandbox" } },
		});
		expect(result.detail).not.toMatch(/ready/i);
	});

	it("checks the sandbox once per offered mode, with the run's env (#673 w51)", async () => {
		const calls: { harness: string; modes: readonly string[]; env?: NodeJS.ProcessEnv }[] = [];
		const result = await probeHarness("codex", {
			descriptor: {
				...descriptor("ok"),
				acpEnv: () => ({ FAKE_ACP_MODE: "ok", FAKE_MODES: "read-only,agent-full-access" }),
			},
			sandbox: async (harness, modes, opts) => {
				calls.push({ harness, modes, env: opts?.env });
				return { "read-only": { state: "enforced", reason: "refused" } };
			},
		});
		expect(calls).toHaveLength(1);
		expect(calls[0]).toMatchObject({ harness: "codex", modes: ["read-only", "agent-full-access"] });
		expect(calls[0]?.env?.FAKE_ACP_MODE).toBe("ok");
		expect(result.sandbox).toEqual({ "read-only": { state: "enforced", reason: "refused" } });
	});

	it("lists the agent's own modes and effort levels by name (#673 w21)", async () => {
		const result = await probeHarness("opencode", {
			descriptor: {
				...descriptor("ok"),
				acpEnv: () => ({ FAKE_ACP_MODE: "ok", FAKE_MODES: "default=Manual,plan=Plan", FAKE_EFFORTS: "low,high" }),
			},
		});
		expect(result.modes).toEqual([
			{ id: "default", name: "Manual" },
			{ id: "plan", name: "Plan" },
		]);
		expect(result.efforts).toEqual([
			{ id: "low", name: "low", default: true },
			{ id: "high", name: "high", default: false },
		]);
	});

	it('says "sign in needed" with the auth method names on ACP -32000', async () => {
		const result = await probeHarness("opencode", {
			descriptor: descriptor("auth-required"),
		});
		expect(result).toEqual({
			id: "opencode",
			outcome: "sign-in-needed",
			detail: "sign in needed (Log in with Fake)",
			hard: false,
		});
	});

	it("maps Codex missing-key start error to sign in needed (API Key, ChatGPT)", () => {
		const session = { authMethods: [] } as unknown as AcpSession;
		const err = new Error(
			'Internal error: CODEX_API_KEY or OPENAI_API_KEY is not set — {"envVars":["CODEX_API_KEY","OPENAI_API_KEY"]}',
		);
		expect(classify(err, session, 10_000)).toEqual({
			outcome: "sign-in-needed",
			detail: "sign in needed (API Key, ChatGPT)",
		});
	});

	it('says "no answer in Ns" when the harness never answers the handshake', async () => {
		const result = await probeHarness("opencode", {
			descriptor: descriptor("hang"),
			timeoutMs: 300,
		});
		expect(result).toEqual({
			id: "opencode",
			outcome: "no-answer",
			detail: "no answer in 1s",
			hard: false,
		});
	});

	it('says "failed to start" when the binary cannot be spawned', async () => {
		const result = await probeHarness("opencode", {
			descriptor: descriptor("ok", "/nonexistent/pl-harness-binary"),
		});
		expect(result.outcome).toBe("failed-to-start");
		expect(result.detail).toMatch(/^failed to start: .*ENOENT/);
	});

	it('says "failed to start" with the stderr tail when the harness exits before answering', async () => {
		const result = await probeHarness("opencode", {
			descriptor: descriptor("unauthenticated"),
		});
		expect(result.outcome).toBe("failed-to-start");
		expect(result.detail).toMatch(/^failed to start: .*not logged in/);
		expect(result.detail).not.toMatch(/\n/);
	});

	it("hands the harness only its provider keys, like the investigation run (ADR 0004 §5)", async () => {
		vi.stubEnv("AWS_SECRET_ACCESS_KEY", "planted-aws");
		vi.stubEnv("ANTHROPIC_API_KEY", "planted-anthropic");
		const result = await probeHarness("claude-code", {
			descriptor: {
				...descriptor("print-env"),
				acpEnv: () => ({
					FAKE_ACP_MODE: "print-env",
					FAKE_ENV_PROBE: "AWS_SECRET_ACCESS_KEY,ANTHROPIC_API_KEY",
				}),
			},
		});
		expect(result.detail).toMatch(/AWS_SECRET_ACCESS_KEY=unset/);
		expect(result.detail).toMatch(/ANTHROPIC_API_KEY=set/);
	});

	it("holds one deadline across initialize and session/new", async () => {
		const started = Date.now();
		const result = await probeHarness("opencode", {
			descriptor: {
				...descriptor("slow-init"),
				acpEnv: () => ({ FAKE_ACP_MODE: "slow-init", FAKE_INIT_DELAY_MS: "300" }),
			},
			timeoutMs: 400,
		});
		expect(result.outcome).toBe("no-answer");
		// Per-request timeouts would take about 300 + 400 ms.
		expect(Date.now() - started).toBeLessThan(600);
	});
});

