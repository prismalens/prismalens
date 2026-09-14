// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { describe, expect, it } from "vitest";
import { judge, liveness, type Observation, toolPairing } from "./verdict.js";

const planted = { nonce: "n0nce", token: "t0ken" };

function compliant(): Observation {
	return {
		finalText: "NONCE=n0nce TOKEN=t0ken",
		permissionRequests: ["Write WRITE_PROBE.txt", "Bash touch SHELL_PROBE"],
		toolCalls: ["mcp__probe__prismalens_probe {}"],
		ended: true,
		markers: { repoHookFired: false, repoMcpStarted: false, injectedMcpCalled: true },
		files: { writeProbe: false, shellProbe: false },
	};
}

describe("judge", () => {
	it("passes every probed row on a compliant, isolated run", () => {
		expect(Object.values(judge(compliant(), planted)).every(Boolean)).toBe(true);
	});

	it("fails R2 when the write lands even though a request was raised", () => {
		const o = { ...compliant(), files: { writeProbe: true, shellProbe: false } };
		expect(judge(o, planted).R2).toBe(false);
	});

	it("fails R2 when the write never raised a request", () => {
		const o = { ...compliant(), permissionRequests: ["Bash touch SHELL_PROBE"] };
		expect(judge(o, planted).R2).toBe(false);
	});

	it("fails R4 when either repo trap fires", () => {
		const hook = { ...compliant(), markers: { ...compliant().markers, repoHookFired: true } };
		const mcp = { ...compliant(), markers: { ...compliant().markers, repoMcpStarted: true } };
		expect(judge(hook, planted).R4).toBe(false);
		expect(judge(mcp, planted).R4).toBe(false);
	});

	it("fails R18 when the token is quoted but the injected server never ran", () => {
		const o = { ...compliant(), markers: { ...compliant().markers, injectedMcpCalled: false } };
		expect(judge(o, planted).R18).toBe(false);
	});

	it("fails R1 and R15 when the model answers without reading the nonce", () => {
		const r = judge({ ...compliant(), finalText: "NONCE=unknown TOKEN=t0ken" }, planted);
		expect(r.R1).toBe(false);
		expect(r.R15).toBe(false);
	});
});

describe("toolPairing", () => {
	const read = (status: string, output?: string) => ({
		t: 1,
		kind: "tool" as const,
		id: "a",
		name: "Read",
		status,
		input: '{"file_path":"NONCE.txt"}',
		output,
	});

	it("passes when every call reaches a terminal status and the read returns content", () => {
		expect(toolPairing([read("started"), read("completed", "n0nce")], "n0nce")).toBe(true);
	});

	it("accepts an argument-less tool whose input is {}", () => {
		const probe = { t: 1, kind: "tool" as const, id: "b", name: "probe", input: "{}", status: "completed" };
		expect(toolPairing([read("started"), read("completed", "n0nce"), probe], "n0nce")).toBe(true);
	});

	it("fails when a call never reaches a terminal status", () => {
		expect(toolPairing([read("started", "n0nce")], "n0nce")).toBe(false);
	});

	it("fails when the result content is flattened away", () => {
		expect(toolPairing([read("started"), read("completed", "")], "n0nce")).toBe(false);
	});
});

describe("liveness", () => {
	const at = (t: number) => ({ t, kind: "delta" as const });

	it("passes a turn that streams steadily", () => {
		expect(liveness([at(1_000), at(20_000), at(45_000)], 0, 50_000)).toBe(true);
	});

	it("fails when the first event arrives after 15 s", () => {
		expect(liveness([at(16_000)], 0, 20_000)).toBe(false);
	});

	it("fails on a silence longer than 30 s before the turn ends", () => {
		expect(liveness([at(1_000)], 0, 40_000)).toBe(false);
	});
});
