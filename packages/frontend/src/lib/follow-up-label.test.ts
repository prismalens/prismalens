// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { CanonicalEvent } from "@prismalens/contracts";
import { describe, expect, it } from "vitest";
import {
	deriveTranscript,
	OPERATOR_STATE_LABEL,
} from "./investigation-events";

const RUN_ID = "00000000-0000-0000-0000-000000000001";
const T0 = Date.parse("2026-09-30T14:27:00Z");
const at = (s: number) => new Date(T0 + s * 1000).toISOString();

let seq = 0;
const base = (s: number) => ({
	runId: RUN_ID,
	branchId: "run",
	path: [],
	seq: seq++,
	label: null,
	ts: at(s),
});

function operator(
	s: number,
	text: string,
	mode: "queue" | "now" = "queue",
	delivered = true,
): CanonicalEvent {
	return { kind: "operator_message", ...base(s), text, mode, delivered };
}

const ended = { status: "completed", live: false };

describe("follow-up label (#673 walk 4)", () => {
	it("resumed operator message with followUp chat resolves to asked state (#673 walk 4)", () => {
		// resumed + followUp "chat" -> state "asked"
		const event: CanonicalEvent = {
			...operator(0, "What failed?"),
			resumed: [{ name: "repo", head: "3b7e0d" }],
			followUp: "chat",
		} as CanonicalEvent;
		const items = deriveTranscript([event], T0, { run: ended });
		const op = items.find((i) => i.kind === "operator");
		expect(op).toMatchObject({ state: "asked" });
	});

	it("resumed operator message with followUp continue resolves to resumed state (#673 walk 4)", () => {
		// resumed + followUp "continue" -> state "resumed"
		const event: CanonicalEvent = {
			...operator(0, "Continue investigation"),
			resumed: [{ name: "repo", head: "3b7e0d" }],
			followUp: "continue",
		} as CanonicalEvent;
		const items = deriveTranscript([event], T0, { run: ended });
		const op = items.find((i) => i.kind === "operator");
		expect(op).toMatchObject({ state: "resumed" });
	});

	it("resumed operator message without followUp on run kind chat resolves to asked state (#673 walk 4)", () => {
		// resumed without followUp on run.kind "chat" -> "asked"
		const event: CanonicalEvent = {
			...operator(0, "What failed?"),
			resumed: [{ name: "repo", head: "3b7e0d" }],
		} as CanonicalEvent;
		const items = deriveTranscript([event], T0, {
			run: { ...ended, kind: "chat" },
		});
		const op = items.find((i) => i.kind === "operator");
		expect(op).toMatchObject({ state: "asked" });
	});

	it("resumed operator message without followUp on run kind investigation resolves to resumed state (#673 walk 4)", () => {
		// resumed without followUp on run.kind "investigation" -> "resumed"
		const event: CanonicalEvent = {
			...operator(0, "Continue investigation"),
			resumed: [{ name: "repo", head: "3b7e0d" }],
		} as CanonicalEvent;
		const items = deriveTranscript([event], T0, {
			run: { ...ended, kind: "investigation" },
		});
		const op = items.find((i) => i.kind === "operator");
		expect(op).toMatchObject({ state: "resumed" });
	});

	it("OPERATOR_STATE_LABEL maps asked to Asked (#673 walk 4)", () => {
		// OPERATOR_STATE_LABEL.asked === "Asked"
		expect(OPERATOR_STATE_LABEL.asked).toBe("Asked");
	});
});
