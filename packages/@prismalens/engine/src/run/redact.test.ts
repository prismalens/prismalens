// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { CanonicalEvent } from "@prismalens/contracts/schemas";
import { describe, expect, it, vi } from "vitest";

const TOKEN = "ghp_0123456789abcdefSECRET";
const BEARER = "pl-gateway-bearer-0123456789";
const echoed = (text: string) =>
	({
		kind: "agent_step",
		runId: "11111111-1111-4111-8111-111111111111",
		branchId: "main",
		seq: 1,
		path: [],
		ts: "2026-11-04T00:00:00.000Z",
		text,
		toolCalls: [{ toolCallId: "c1", name: "shell", args: { command: `echo ${TOKEN}` } }],
	}) as unknown as CanonicalEvent;

vi.mock("./investigate.js", () => ({
	isCancelledError: () => false,
	async *runInvestigation() {
		yield echoed(`token is ${TOKEN} and bearer ${BEARER}`);
	},
}));

const { conductRun } = await import("./conductor.js");
const { injectedSecrets, redactEvent } = await import("./redact.js");

describe("the run's own credentials never reach its events (#1020, CP4 OBJ-015)", () => {
	it("finds the GitHub token values the agent's env may hold, whatever the name's case, and the bearer", () => {
		const found = injectedSecrets({ gh_token: TOKEN, PATH: "/bin", GITHUB_TOKEN: "short" }, [BEARER, undefined]);
		expect(found).toEqual(expect.arrayContaining([TOKEN, BEARER]));
		// Too short to redact without eating ordinary words.
		expect(found).not.toContain("short");
	});

	it("redacts every exact value anywhere in an event and leaves a clean one as it is", () => {
		const out = redactEvent(echoed(`x ${TOKEN} y`), [TOKEN]);
		expect(JSON.stringify(out)).not.toContain(TOKEN);
		expect(JSON.stringify(out)).toContain("[redacted]");
		const clean = echoed("nothing here");
		expect(redactEvent(clean, [BEARER])).toBe(clean);
	});

	it("redacts a secret that JSON escapes (quote, backslash, newline)", () => {
		const odd = 'pa"ss\\word\nline';
		const out = redactEvent(echoed(`x ${odd} y`), [odd]);
		expect(JSON.stringify(out)).not.toContain(JSON.stringify(odd).slice(1, -1));
		expect(JSON.stringify(out)).toContain("[redacted]");
	});

	it("conductRun streams and stores the redacted event", async () => {
		const sink = vi.fn();
		const append = vi.fn(async () => {});
		await conductRun(
			{
				runId: "11111111-1111-4111-8111-111111111111",
				gateway: { token: BEARER },
				hostEnv: { GH_TOKEN: TOKEN },
				kind: "chat",
			} as never,
			{
				sink,
				store: { create: async () => {}, append, finish: async () => {}, fail: async () => {}, flush: async () => {} },
			},
		);
		for (const e of [...sink.mock.calls, ...append.mock.calls].map((c) => JSON.stringify(c[0]))) {
			expect(e).not.toContain(TOKEN);
			expect(e).not.toContain(BEARER);
		}
		expect(append).toHaveBeenCalled();
	});
});
