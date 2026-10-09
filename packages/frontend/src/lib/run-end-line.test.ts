// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { describe, expect, it } from "vitest";
import { endHint, isStopMessage, messageEndLine } from "./run-end-line";

describe("end-line sentences (#673 w59, DESIGN §3)", () => {
	it("a stopped reportless investigation offers both verbs when its session reopens", () => {
		expect(endHint({ kind: "investigation", status: "cancelled", continuable: true })).toBe(
			"Investigate to finish the report, or ask about what it found.",
		);
		expect(endHint({ kind: "investigation", status: "cancelled", continuable: false })).toBeNull();
	});

	it("a failed reportless investigation: try again when continuable, else a new run", () => {
		expect(endHint({ kind: "investigation", status: "failed", continuable: true })).toBe(
			"Investigate to try the report again, or ask about what it found.",
		);
		expect(endHint({ kind: "investigation", status: "failed" })).toBe("Start a new run.");
	});

	it("a chat, and a thread with a report, add nothing", () => {
		expect(endHint({ kind: "chat", status: "cancelled", continuable: false })).toBeNull();
		expect(endHint({ kind: "chat", status: "failed" })).toBeNull();
		expect(endHint({ kind: "investigation", status: "completed", hasReport: true })).toBeNull();
	});

	it("a follow-up's own end: a stop at its time, else the agent's sentence", () => {
		expect(isStopMessage("investigation cancelled")).toBe(true);
		expect(messageEndLine("investigation cancelled", "2026-10-08T17:40:00Z")).toMatch(/^Stopped by you at \d{1,2}:\d{2}/);
		expect(messageEndLine("the agent crashed.", null)).toBe("The agent stopped: the agent crashed");
	});
});
