// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { probeHarness } from "./harness-doctor.js";

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
			detail: "answers ACP",
			hard: false,
		});
		expect(result.detail).not.toMatch(/ready/i);
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
		const planted = {
			AWS_SECRET_ACCESS_KEY: "planted-aws",
			ANTHROPIC_API_KEY: "planted-anthropic",
		};
		Object.assign(process.env, planted);
		try {
			const result = await probeHarness("claude-code", {
				descriptor: {
					...descriptor("print-env"),
					acpEnv: () => ({
						FAKE_ACP_MODE: "print-env",
						FAKE_ENV_PROBE: Object.keys(planted).join(","),
					}),
				},
			});
			expect(result.detail).toMatch(/AWS_SECRET_ACCESS_KEY=unset/);
			expect(result.detail).toMatch(/ANTHROPIC_API_KEY=set/);
		} finally {
			for (const key of Object.keys(planted)) delete process.env[key];
		}
	});
});
