// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { describe, expect, it } from "vitest";
import {
	parseTranscript,
	permissionDecisions,
	proveCwd,
	redactNonce,
	initializeVersion,
	type WireLine,
} from "./admission-checks.js";

const NONCE = "a3f1c0de9b7245188cbf0e6d2a44b710";
const BASENAME = "PRISMALENS_CWD_PROBE.txt";

const wire = (d: "in" | "out", m: unknown): string =>
	JSON.stringify({ t: 1, d, m: typeof m === "string" ? m : JSON.stringify(m) });

const line = (d: "in" | "out", m: string): WireLine => ({ t: 1, d, m });

describe("parseTranscript", () => {
	it("keeps well-formed lines and drops blanks", () => {
		const raw = `${wire("out", "a")}\n\n${wire("in", "b")}\n`;
		expect(parseTranscript(raw).map((l) => l.m)).toEqual(["a", "b"]);
	});

	it("survives a truncated tail line from a killed run", () => {
		const raw = `${wire("in", "ok")}\n{"t":2,"d":"in","m":"trunc`;
		expect(parseTranscript(raw).map((l) => l.m)).toEqual(["ok"]);
	});

	it("drops lines with no string payload", () => {
		expect(parseTranscript('{"t":1,"d":"in"}\n')).toEqual([]);
	});
});

describe("permissionDecisions", () => {
	const lines = parseTranscript(
		[
			wire("out", { jsonrpc: "2.0", method: "session/prompt" }),
			wire("in", { permission: { title: "cat ./x" }, allowed: true }),
			wire("in", "not json at all"),
			wire("in", {
				permission: { title: "echo probe > PRISMALENS_ADMISSION.txt" },
				allowed: false,
				why: "shell command would mutate",
			}),
		].join("\n"),
	);

	it("returns only the synthesised decision lines, in order", () => {
		expect(permissionDecisions(lines).map((d) => d.allowed)).toEqual([
			true,
			false,
		]);
	});

	it("ignores JSON-RPC frames that carry no permission", () => {
		expect(
			permissionDecisions([line("in", '{"jsonrpc":"2.0","id":1}')]),
		).toEqual([]);
	});
});

describe("proveCwd", () => {
	it("passes when the nonce comes back in a tool result", () => {
		const lines = parseTranscript(
			[
				wire("out", `run cat ./${BASENAME}`),
				wire("in", {
					method: "session/update",
					params: {
						update: {
							sessionUpdate: "tool_call",
							kind: "execute",
							rawInput: { command: `cat ./${BASENAME}` },
						},
					},
				}),
				wire("in", {
					method: "session/update",
					params: { content: [{ type: "content", text: `${NONCE}\n` }] },
				}),
			].join("\n"),
		);
		expect(proveCwd(lines, { nonce: NONCE, basename: BASENAME })).toEqual({
			attempted: true,
			proved: true,
		});
	});

	// The flake this check replaces: the model ran the probe and reported it
	// correctly, but paraphrased instead of pasting. Prose must not be the
	// evidence — the tool result is.
	it("passes when the model paraphrases instead of quoting the output", () => {
		const lines = parseTranscript(
			[
				wire("in", {
					method: "session/update",
					params: { content: [{ type: "content", text: NONCE }] },
				}),
				wire("in", {
					method: "session/update",
					params: {
						update: {
							sessionUpdate: "agent_message_chunk",
							content: {
								type: "text",
								text: "Verified the working directory and the write refusal.",
							},
						},
					},
				}),
			].join("\n"),
		);
		expect(proveCwd(lines, { nonce: NONCE, basename: BASENAME }).proved).toBe(
			true,
		);
	});

	it("separates a failed read from no attempt at all", () => {
		const failed = parseTranscript(
			wire("in", {
				params: { content: [{ text: `cat: ${BASENAME}: No such file` }] },
			}),
		);
		expect(proveCwd(failed, { nonce: NONCE, basename: BASENAME })).toEqual({
			attempted: true,
			proved: false,
		});

		const silent = parseTranscript(wire("in", { params: { content: [] } }));
		expect(proveCwd(silent, { nonce: NONCE, basename: BASENAME })).toEqual({
			attempted: false,
			proved: false,
		});
	});

	// Guards the proof against going vacuous: if the nonce ever reached the
	// prompt, every run would "prove" the cwd without reading anything.
	it("refuses to count the nonce on an outbound line", () => {
		const lines = parseTranscript(wire("out", `the nonce is ${NONCE}`));
		expect(proveCwd(lines, { nonce: NONCE, basename: BASENAME }).proved).toBe(
			false,
		);
	});

	it("never passes on an empty nonce", () => {
		const lines = parseTranscript(wire("in", "anything at all"));
		expect(proveCwd(lines, { nonce: "", basename: BASENAME }).proved).toBe(
			false,
		);
	});
});

describe("redactNonce", () => {
	it("removes every occurrence", () => {
		expect(redactNonce(`${NONCE} and ${NONCE}`, NONCE)).toBe(
			"<nonce> and <nonce>",
		);
	});

	it("is a no-op for an empty nonce", () => {
		expect(redactNonce("untouched", "")).toBe("untouched");
	});
});

describe("initializeVersion", () => {
	it("extracts agentInfo.version from the initialize response", () => {
		const lines: WireLine[] = [
			{
				t: 1,
				d: "out",
				m: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize" }),
			},
			{
				t: 2,
				d: "in",
				m: JSON.stringify({
					jsonrpc: "2.0",
					id: 1,
					result: {
						protocolVersion: 1,
						agentInfo: { name: "opencode", version: "1.18.30" },
					},
				}),
			},
		];
		expect(initializeVersion(lines)).toBe("1.18.30");
	});

	it("returns null when no initialize response or version is present", () => {
		const lines: WireLine[] = [
			{
				t: 1,
				d: "in",
				m: JSON.stringify({ jsonrpc: "2.0", id: 1, result: {} }),
			},
			{ t: 2, d: "in", m: "plain text" },
		];
		expect(initializeVersion(lines)).toBeNull();
	});
});
