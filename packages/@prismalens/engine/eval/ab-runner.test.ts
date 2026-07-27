// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { CanonicalEvent } from "@prismalens/contracts";
import { describe, expect, it } from "vitest";
import { type ArmRun, harnessFailure, skillNative } from "./ab-runner.js";

function evt(partial: Partial<CanonicalEvent> & { kind: string }): CanonicalEvent {
	return {
		runId: "run-1",
		branchId: "root",
		path: [],
		seq: 0,
		label: null,
		ts: "2026-07-26T00:00:00.000Z",
		...partial,
	} as CanonicalEvent;
}

function armRun(over: Partial<ArmRun>): ArmRun {
	return {
		arm: "raw",
		report: { rawText: "" },
		rawText: "",
		costUsd: 0,
		providerCost: { claudeUsd: 0 },
		timeToReportMs: 100,
		tokens: { input: 0, output: 0 },
		events: [],
		...over,
	} as ArmRun;
}

describe("harnessFailure", () => {
	it("flags an error with zero tokens — the harness never reached a model", () => {
		// The live 2026-07-26 shape: auth failed under isolateSettings, the error text
		// became rawText, and the judge scored it 0.2.
		const run = armRun({
			rawText: "Not logged in · Please run /login",
			events: [
				evt({ kind: "agent_step", text: "" }),
				evt({ kind: "branch_done" }),
				evt({
					kind: "error",
					message: "Claude Code returned an error result: Not logged in",
				}),
			],
		});
		const reason = harnessFailure(run);
		expect(reason).not.toBeNull();
		expect(reason).toContain("never reached a model");
		expect(reason).toContain("Not logged in");
	});

	it("does NOT flag an error that arrived after real model work", () => {
		// A paid arm that errored late still produced a scorable investigation;
		// discarding it would throw away the expensive half of the run.
		const run = armRun({
			rawText: "Root cause: connection pool exhaustion.",
			tokens: { input: 4000, output: 900 },
			events: [
				evt({ kind: "agent_step", text: "Root cause: pool exhaustion." }),
				evt({ kind: "error", message: "stream closed late" }),
			],
		});
		expect(harnessFailure(run)).toBeNull();
	});

	it("does NOT flag a clean run", () => {
		const run = armRun({
			rawText: "Root cause: connection pool exhaustion.",
			tokens: { input: 4000, output: 900 },
			events: [
				evt({ kind: "agent_step", text: "Root cause: pool exhaustion." }),
				evt({ kind: "branch_done" }),
			],
		});
		expect(harnessFailure(run)).toBeNull();
	});

	it("does NOT flag a zero-token run that never errored", () => {
		// No error event means nothing went wrong to report, whatever the token count.
		expect(harnessFailure(armRun({ events: [evt({ kind: "branch_done" })] }))).toBeNull();
	});
});

describe("skillNative", () => {
	it("yields plugins and skills keys when skillPluginPath is provided", () => {
		const res = skillNative("/path/to/plugin");
		expect(res).toEqual({
			plugins: [{ type: "local", path: "/path/to/plugin" }],
			skills: ["incident-response"],
		});
	});

	it("yields empty object {} when skillPluginPath is absent or undefined", () => {
		expect(skillNative()).toEqual({});
		expect(skillNative(undefined)).toEqual({});
	});
});
