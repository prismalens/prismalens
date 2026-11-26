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
const { injectedSecrets, redactEvent, redactLine, requestedSecrets, scrub, StreamScrubber } = await import(
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

	it("redactEvent replaces inside string values, keeps a kind and a schema field name, so an argument equal to an event kind cannot change an event", () => {
		const event = { kind: "turn_usage", text: "turn_usage", nested: [{ text: `x turn_usage y` }] };
		expect(redactEvent(event, ["turn_usage"])).toEqual({
			kind: "turn_usage",
			text: "[redacted]",
			nested: [{ text: "x [redacted] y" }],
		});
	});

	it("redactEvent keeps schema values equal to a secret, nested in arrays, and redacts the same word in what the agent named", () => {
		const loadout = {
			kind: "agent_loadout",
			profile: "own",
			items: [
				{ kind: "mcp", name: "loads", scope: "prismalens", state: "loads", transport: "stdio", layer: "config" },
				{ kind: "mcp", name: "mcp", scope: "repo", state: "not-sent", transport: "http", layer: "config" },
			],
		};
		expect([redactEvent(loadout, ["loads"]), redactEvent(loadout, ["mcp", "repo"])]).toEqual([
			{ ...loadout, items: [{ ...loadout.items[0], name: "[redacted]" }, loadout.items[1]] },
			{ ...loadout, items: [loadout.items[0], { ...loadout.items[1], name: "[redacted]" }] },
		]);
	});

	it("redactEvent scrubs a secret in a key the agent or a person named, keeping two such keys apart", () => {
		const step = {
			kind: "agent_step",
			text: "ok",
			toolCalls: [{ toolCallId: "t1", name: "x", args: { "sv-key-one": 1, "sv-key-two": 2, plain: "sv-key-one" } }],
		};
		expect(redactEvent(step, ["sv-key-one", "sv-key-two"])).toEqual({
			kind: "agent_step",
			text: "ok",
			toolCalls: [{ toolCallId: "t1", name: "x", args: { "[redacted]": 1, "[redacted] 2": 2, plain: "[redacted]" } }],
		});
	});

	it("redactLine writes a parsed line back from what it parsed, so a repeated member or a key cannot carry a secret through", () => {
		const secret = "sv-wire-0123456789";
		expect([
			redactLine(`{"a":"${secret}","a":"x"}`, [secret]),
			redactLine(`{"${secret}":1}`, [secret]),
			redactLine(`{"a":"\\u0073v-wire-0123456789"}`, [secret]),
			redactLine(`{"a":1,"b":[true,null,"keep"]}`, [secret]),
		]).toEqual(['{"a":"x"}', '{"[redacted]":1}', '{"a":"[redacted]"}', '{"a":1,"b":[true,null,"keep"]}']);
	});

	it("redactLine scrubs a line that does not parse, and one holding text that is not valid UTF-16, as text", () => {
		const secret = "sv-wire-0123456789";
		const lone = String.fromCharCode(0xd800);
		expect([
			redactLine(`{"a":"${secret}"`, [secret]),
			redactLine(`not json ${secret}${lone}`, [secret]),
			redactLine(JSON.stringify({ a: `${lone}${secret}` }), [secret]),
		]).toEqual(['{"a":"[redacted]"', `not json [redacted]${lone}`, JSON.stringify({ a: `${lone}[redacted]` })]);
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
