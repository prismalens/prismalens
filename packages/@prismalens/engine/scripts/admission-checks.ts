// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * Pure assertions over an admission run's raw wire transcript.
 *
 * Split out of `acp-admission.ts` because that file is a top-level-await
 * entrypoint and cannot be imported under test. The gate runs unattended and
 * decides a registry row, so every predicate it votes on needs a regression
 * test: a check that is silently vacuous, or one a *compliant* model can fail
 * on wording alone, is worse than no check at all.
 *
 * The working-directory proof reads the RAW transcript rather than the
 * canonical `tool_result` events, whose `preview` is truncated and flattened in
 * `adapter/acp-adapter.ts` and would drop the nonce on a long result.
 */

/** One line of `<runDir>/transcript.jsonl`, as written by `runInvestigation`. */
export interface WireLine {
	t: number;
	/** `in` — from the harness, plus the synthesised permission decisions. */
	d: "in" | "out";
	m: string;
}

/** A permission decision, as `runInvestigation` synthesises it onto the wire. */
export interface PermissionDecisionLine {
	permission?: { title?: string };
	allowed?: boolean;
	why?: string;
}

/** Verdict on whether the harness really executed inside the clone. */
export interface CwdProof {
	/** The probe file was named back to us: the harness saw the directive. */
	attempted: boolean;
	/** The nonce came back from the harness: the read happened, in the clone. */
	proved: boolean;
}

/** Tolerant of partial writes: the transcript is appended best-effort. */
export function parseTranscript(raw: string): WireLine[] {
	const lines: WireLine[] = [];
	for (const line of raw.split("\n")) {
		if (!line) continue;
		try {
			const parsed = JSON.parse(line) as Partial<WireLine>;
			if (typeof parsed.m !== "string") continue;
			lines.push({
				t: typeof parsed.t === "number" ? parsed.t : 0,
				d: parsed.d === "out" ? "out" : "in",
				m: parsed.m,
			});
		} catch {
			// A truncated tail line is expected when a run is killed.
		}
	}
	return lines;
}

/**
 * Pick out the decision lines `runInvestigation` synthesises onto the wire.
 * Most lines are JSON-RPC frames and a few are not JSON at all; both are
 * skipped rather than treated as a parse failure.
 */
export function permissionDecisions(
	lines: WireLine[],
): PermissionDecisionLine[] {
	const decisions: PermissionDecisionLine[] = [];
	for (const line of lines) {
		try {
			const parsed = JSON.parse(line.m) as PermissionDecisionLine;
			if (parsed?.permission !== undefined) decisions.push(parsed);
		} catch {
			// Most wire lines are JSON-RPC frames, not decisions.
		}
	}
	return decisions;
}

/**
 * A nonce planted in the clone before the run is unforgeable: the harness can
 * only return it by reading that file, which it can only do from that
 * directory. That replaces asserting the clone path appears in the model's
 * prose — the model is told to use relative paths, so a model that did the work
 * correctly still failed that check whenever it summarised instead of pasting
 * (prismalens#621, #623).
 *
 * Only inbound lines count. The prompt names the probe file but never the
 * nonce, so an outbound match would mean the nonce had leaked into the prompt
 * and the proof had gone vacuous.
 */
export function proveCwd(
	lines: WireLine[],
	probe: { nonce: string; basename: string },
): CwdProof {
	const inbound = lines.filter((l) => l.d === "in").map((l) => l.m);
	return {
		attempted: inbound.some((m) => m.includes(probe.basename)),
		proved:
			probe.nonce.length > 0 && inbound.some((m) => m.includes(probe.nonce)),
	};
}

/** Keep the nonce out of CI logs; it looks like a credential and is not one. */
export function redactNonce(text: string, nonce: string): string {
	if (!nonce) return text;
	return text.split(nonce).join("<nonce>");
}
