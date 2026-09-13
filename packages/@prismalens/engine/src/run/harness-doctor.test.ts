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

function descriptor(mode: string) {
	return {
		binary: process.execPath,
		acpArgs: () => [FAKE],
		acpEnv: () => ({ FAKE_ACP_MODE: mode }),
		configFiles: () => ({}),
	};
}

describe("probeHarness", () => {
	it("reports ready after a successful initialize + session/new, and closes the session", async () => {
		const result = await probeHarness("opencode", {
			descriptor: descriptor("ok"),
		});
		expect(result).toEqual({
			id: "opencode",
			ready: true,
			detail: "ready",
			hard: false,
		});
	});

	it("reports the harness's own stderr tail, one line, when it exits during the handshake", async () => {
		const result = await probeHarness("opencode", {
			descriptor: descriptor("unauthenticated"),
		});
		expect(result.ready).toBe(false);
		expect(result.hard).toBe(false);
		expect(result.detail).toContain("not logged in");
		expect(result.detail).not.toMatch(/\n/);
	});

	it('reports "no answer in Ns" when the harness never answers the handshake', async () => {
		const result = await probeHarness("opencode", {
			descriptor: descriptor("hang"),
			timeoutMs: 300,
		});
		expect(result).toEqual({
			id: "opencode",
			ready: false,
			detail: "no answer in 1s",
			hard: false,
		});
	});
});
