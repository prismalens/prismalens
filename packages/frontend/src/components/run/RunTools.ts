// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type {
	CanonicalEvent,
	CheckoutSkipped,
	RunWorkspace,
} from "@prismalens/contracts";

type ToolCall = Extract<CanonicalEvent, { kind: "harness_tool_call" }>;
type ToolsSummary = Extract<CanonicalEvent, { kind: "harness_tools" }>;
export type Turn = ToolCall["turn"];

export interface TurnTools {
	turn: Turn;
	/** null until the turn's summary says; a call means it connected. */
	connected: boolean | null;
	calls: { name: string; count: number; firstCalledAt: string }[];
	total: number;
	firstAt: string | null;
}

/** Whether PrismaLens's tools reached the model (#848); loading and error are never "no calls". */
export type ToolsStatus =
	| { state: "loading" }
	| { state: "error" }
	| { state: "reached"; firstAt: string }
	| { state: "connected" }
	| { state: "not-reached" }
	/** Live, and nothing recorded yet. */
	| { state: "waiting" }
	/** Ended with no record: a run from before #848. */
	| { state: "unknown" };

const clockFmt = new Intl.DateTimeFormat(undefined, {
	hour: "2-digit",
	minute: "2-digit",
	second: "2-digit",
	hour12: false,
});
/** The first call to the second: two calls a minute apart read apart. */
export const clockSec = (at: string) => clockFmt.format(new Date(at));

const earlier = (a: string | null, b: string) =>
	!a || new Date(b).getTime() < new Date(a).getTime() ? b : a;

/**
 * Per turn, from the persisted events: each live `harness_tool_call`, and the
 * turn's `harness_tools` summary, which counts every call when it lands. A
 * reload mid-turn reads the calls so far.
 */
export function toolTurns(events: readonly CanonicalEvent[]): TurnTools[] {
	const turns = new Map<Turn, TurnTools>();
	const turnOf = (t: Turn) => {
		let v = turns.get(t);
		if (!v) {
			v = { turn: t, connected: null, calls: [], total: 0, firstAt: null };
			turns.set(t, v);
		}
		return v;
	};
	const live = new Map<Turn, Map<string, { count: number; first: string }>>();
	for (const e of events) {
		if (e.kind === "harness_tool_call") {
			const per = live.get(e.turn) ?? new Map();
			const had = per.get(e.name);
			per.set(e.name, {
				count: (had?.count ?? 0) + 1,
				first: earlier(had?.first ?? null, e.at),
			});
			live.set(e.turn, per);
			turnOf(e.turn).connected = true;
		} else if (e.kind === "harness_tools") {
			const t = turnOf(e.turn);
			t.connected = e.connected || e.calls.length > 0;
			t.calls = e.calls.map((c) => ({ ...c }));
		}
	}
	for (const [turn, per] of Array.from(live)) {
		const t = turnOf(turn);
		for (const [name, v] of Array.from(per)) {
			const s = t.calls.find((c) => c.name === name);
			if (!s) t.calls.push({ name, count: v.count, firstCalledAt: v.first });
			else {
				s.count = Math.max(s.count, v.count);
				s.firstCalledAt = earlier(s.firstCalledAt, v.first);
			}
		}
	}
	return (["first", "follow-up"] as const).flatMap((k) => {
		const t = turns.get(k);
		if (!t) return [];
		t.total = t.calls.reduce((a, c) => a + c.count, 0);
		t.firstAt = t.calls.reduce<string | null>(
			(a, c) => earlier(a, c.firstCalledAt),
			null,
		);
		return [t];
	});
}

export function toolsStatus(
	turns: TurnTools[],
	o: { loading: boolean; error: boolean; live: boolean },
): ToolsStatus {
	if (o.loading) return { state: "loading" };
	if (o.error) return { state: "error" };
	const firstAt = turns.reduce<string | null>(
		(a, t) => (t.firstAt ? earlier(a, t.firstAt) : a),
		null,
	);
	if (firstAt) return { state: "reached", firstAt };
	if (turns.some((t) => t.connected)) return { state: "connected" };
	if (turns.some((t) => t.connected === false)) return { state: "not-reached" };
	return o.live ? { state: "waiting" } : { state: "unknown" };
}

/** The Tools line: "reached the model (first call 12:04:31)" and the rest (§4b). */
export function toolsWord(s: ToolsStatus): string {
	switch (s.state) {
		case "loading":
			return "Loading";
		case "error":
			return "Did not load";
		case "reached":
			return `Reached the model (first call ${clockSec(s.firstAt)})`;
		case "connected":
			return "Connected, not yet called";
		case "not-reached":
			return "Did not reach the model";
		case "waiting":
			return "Not called yet";
		case "unknown":
			return "Not recorded for this run";
	}
}

/** "2 calls, first at 12:04:31"; a turn with none says so. */
export function turnLine(t: TurnTools): string {
	if (!t.total)
		return t.connected === false ? "Not connected" : "Connected, no calls";
	return `${t.total} ${t.total === 1 ? "call" : "calls"}, first at ${clockSec(t.firstAt ?? "")}`;
}

/**
 * The folder Gemini's folder trust would need: the runs folder above the
 * session cwd (#848, gap 5). Its own trust command is unconfirmed, so only
 * the path is offered.
 */
export function runsFolder(cwd: string | null | undefined): string | null {
	if (!cwd) return null;
	const m = cwd.match(/^(.*?[\\/]runs)(?:[\\/]|$)/);
	return m?.[1] ?? null;
}

const SKIP_WORD: Record<CheckoutSkipped["code"], string> = {
	budget: "Skipped: the time for checkouts ran out",
	failed: "Not checked out",
	guard: "Skipped: over the 32-repository guard",
};

export const skippedWord = (s: Pick<CheckoutSkipped, "code">) =>
	SKIP_WORD[s.code];

/** The Code step: one repository's name, or "8 repositories, 1 skipped". */
export function codeLine(
	workspace: Pick<RunWorkspace, "repos"> | null | undefined,
	skipped: readonly CheckoutSkipped[],
): string {
	const n = workspace?.repos.length ?? 0;
	const s = skipped.length ? `, ${skipped.length} skipped` : "";
	if (n === 0) return skipped.length ? `None${s}` : "Ran without code";
	if (n === 1 && !s) return workspace?.repos[0]?.name ?? "1 repository";
	return `${n + skipped.length} repositories${s}`;
}
