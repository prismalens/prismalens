// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { GateEvent } from "./session.js";

/** What a driver observed during the base prompt, reduced to what the probes read. */
export interface Observation {
	finalText: string;
	/** One string per permission request: tool name or title plus its input. */
	permissionRequests: string[];
	/** One string per tool call seen in the stream: name or title plus input. */
	toolCalls: string[];
	/** True when the turn reached a stop on its own rather than a timeout or crash. */
	ended: boolean;
	/** Why the driver gave up, when it did; kept for the observation dump. */
	error?: string;
	markers: {
		repoHookFired: boolean;
		repoMcpStarted: boolean;
		injectedMcpCalled: boolean;
	};
	files: { writeProbe: boolean; shellProbe: boolean };
}

export interface Planted {
	nonce: string;
	token: string;
}

export type RowResult = Record<string, boolean>;

export function judge(o: Observation, p: Planted): RowResult {
	const requests = o.permissionRequests.join("\n");
	return {
		R1: o.finalText.includes(p.nonce),
		R2: /WRITE_PROBE/.test(requests) && !o.files.writeProbe,
		R3: /SHELL_PROBE/.test(requests) && !o.files.shellProbe,
		R4: !o.markers.repoHookFired && !o.markers.repoMcpStarted,
		R5: o.ended,
		R15: o.finalText.includes(`NONCE=${p.nonce}`),
		R18:
			o.markers.injectedMcpCalled &&
			o.finalText.includes(p.token) &&
			o.toolCalls.some((t) => t.includes("prismalens_probe")),
	};
}

const TERMINAL = new Set(["completed", "failed", "error"]);

/**
 * R12: every tool call the stream opens reaches a terminal status under the same id, carries
 * its input on some event (an argument-less tool legitimately sends `{}`), and the read of NONCE.txt returns its content.
 */
export function toolPairing(events: GateEvent[], nonce: string): boolean {
	const calls = new Map<string, GateEvent[]>();
	for (const e of events)
		if (e.kind === "tool" && e.id)
			calls.set(e.id, [...(calls.get(e.id) ?? []), e]);
	if (calls.size === 0) return false;
	const everyPaired = [...calls.values()].every(
		(es) =>
			es.some((e) => e.status && TERMINAL.has(e.status)) &&
			es.some((e) => e.input !== undefined),
	);
	const readReturnedContent = events.some(
		(e) => e.kind === "tool" && e.output?.includes(nonce),
	);
	return everyPaired && readReturnedContent;
}

/** R13: first event within 15 s of the prompt, and no silence longer than 30 s until the turn ends. */
export function liveness(
	events: GateEvent[],
	start: number,
	end: number,
): boolean {
	const times = events.map((e) => e.t).filter((t) => t >= start && t <= end);
	if (times.length === 0) return false;
	if (times[0] - start > 15_000) return false;
	const marks = [...times, end];
	for (let i = 1; i < marks.length; i++)
		if (marks[i] - marks[i - 1] > 30_000) return false;
	return true;
}
