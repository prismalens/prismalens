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
const { injectedSecrets, RecordScrubber, redactEvent, requestedSecrets, scrub, StreamScrubber } = await import(
	"./redact.js"
);

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

describe("requestedSecrets (#1024 spec B)", () => {
	it("keeps a value the user handed the thread whatever its length, longest first, so one inside another leaves nothing behind", () => {
		const secrets = requestedSecrets(["abc", "abcdef", undefined, "", "abc"]);
		expect(secrets).toEqual(["abcdef", "abc"]);
		expect(scrub("token abcdef and abc", secrets)).toBe("token [redacted] and [redacted]");
		expect(redactEvent({ text: "say abc" }, secrets)).toEqual({ text: "say [redacted]" });
	});
});

describe("shared values never reach a stream, even split across pieces (#1180 §3.3)", () => {
	const VALUE = 'sv-"quoted"\back\nline-9f';
	const joined = (units: string[][]) => units.map((u) => u.join("")).join("");
	const run = (s: InstanceType<typeof StreamScrubber>, units: string[][]) => [
		...units.flatMap((u) => s.push(u)),
		...s.end(),
	];

	it("replaces a value split across two stderr chunks in both chunks", () => {
		const out = run(new StreamScrubber([VALUE]), [[`err ${VALUE.slice(0, 7)}`], [`${VALUE.slice(7)} tail`]]);
		expect(out).toEqual([["err [redacted]"], ["[redacted] tail"]]);
	});

	it("replaces a value split across three streamed chunks with a tool update between two of them", () => {
		const a = VALUE.slice(0, 5);
		const b = VALUE.slice(5, 12);
		const c = VALUE.slice(12);
		const msg = (text: string) => ({ text, channel: "message" });
		const out = run(new StreamScrubber([VALUE]), [[msg(a)], [msg(b), "tool_call_update"], [msg(c), "done"]]);
		expect(joined(out)).not.toContain(VALUE);
		expect(out).toEqual([["[redacted]"], ["[redacted]", "tool_call_update"], ["[redacted]", "done"]]);
	});

	it("holds a unit back until enough text follows it, and releases the rest at the end", () => {
		const s = new StreamScrubber(["0123456789"]);
		expect(s.push(["abc"])).toEqual([]);
		expect(s.push(["defghijklmnop"])).toEqual([["abc"]]);
		expect(s.end()).toEqual([["defghijklmnop"]]);
	});

	it("replaces the JSON-escaped form inside a string that carries encoded JSON", () => {
		const encoded = JSON.stringify({ arg: VALUE });
		expect(joined(run(new StreamScrubber([VALUE]), [[encoded]]))).toBe('{"arg":"[redacted]"}');
	});

	it("redactEvent replaces inside string values only, never a key or a kind, so an argument equal to an event kind cannot change an event", () => {
		const event = { kind: "turn_usage", turn_usage: "turn_usage", nested: [{ text: `x turn_usage y` }] };
		expect(redactEvent(event, ["turn_usage"])).toEqual({
			kind: "turn_usage",
			turn_usage: "[redacted]",
			nested: [{ text: "x [redacted] y" }],
		});
	});

	it("redactEvent scrubs a kind inside a tool's input or arguments, which the agent wrote, while the event's own kind stays", () => {
		const secret = "shared-value-0123456789";
		const call = { kind: "harness_tool_call", input: { kind: secret, deep: [{ kind: secret }] } };
		const step = { kind: "agent_step", toolCalls: [{ toolCallId: "t1", name: "x", args: { kind: secret } }] };
		expect([redactEvent(call, [secret]), redactEvent(step, [secret])]).toEqual([
			{ kind: "harness_tool_call", input: { kind: "[redacted]", deep: [{ kind: "[redacted]" }] } },
			{ kind: "agent_step", toolCalls: [{ toolCallId: "t1", name: "x", args: { kind: "[redacted]" } }] },
		]);
	});

	it("redactEvent scrubs a form field named kind in an ask's answer, and keeps the answer's own kind", () => {
		const secret = "shared-value-0123456789";
		const closed = { kind: "ask_closed", askId: "a1", outcome: "answered", answer: { kind: "input", values: { kind: secret, other: secret } } };
		expect(redactEvent(closed, [secret])).toEqual({
			kind: "ask_closed",
			askId: "a1",
			outcome: "answered",
			answer: { kind: "input", values: { kind: "[redacted]", other: "[redacted]" } },
		});
	});
});

describe("RecordScrubber (#1180 §3.3)", () => {
	const VALUE = 'sv-"quoted"\back\nline-9f';
	const msg = (text: string) => ({ kind: "agent_step", text, toolCalls: [] as unknown[] });
	const tool = { kind: "tool_result", toolCallId: "t1", output: "ok" };
	const channel = (r: { kind: string }, path: readonly (string | number)[]) =>
		path.join(".") === "text" && r.kind === "agent_step" ? "message" : "";

	it("replaces a value split across two records' string values with a record between, and keeps every shape", () => {
		const s = new RecordScrubber<Record<string, unknown>>([VALUE], channel);
		const out = [msg(`see ${VALUE.slice(0, 6)}`), tool, msg(`${VALUE.slice(6)} end`)].flatMap((r) => s.push(r));
		expect([...out, ...s.end()]).toEqual([msg("see [redacted]"), tool, msg("[redacted] end")]);
	});

	it("gives back the same record when nothing in it changed, and never touches a kind", () => {
		const s = new RecordScrubber<Record<string, unknown>>(["agent_step"], channel);
		const plain = { kind: "agent_step", text: "nothing here", toolCalls: [] };
		expect([...s.push(plain), ...s.end()][0]).toBe(plain);
	});

	it("leaves a value whose channel is null as it is", () => {
		const s = new RecordScrubber<{ kind: string; m: string; held: string }>([VALUE], (_, p) => (p[0] === "held" ? "" : null));
		expect([...s.push({ kind: "x", m: VALUE, held: VALUE }), ...s.end()]).toEqual([{ kind: "x", m: VALUE, held: "[redacted]" }]);
	});
});
