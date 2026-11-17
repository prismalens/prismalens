// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { SessionOpening } from "@prismalens/contracts";

export interface SessionNames {
	agent: (id: string) => string;
	model: (id: string) => string;
}

const CAUSE_WORDS: Partial<Record<SessionOpening["cause"], string>> = {
	limit: "after the usage limit reset",
	wake: "woken by a scheduled wake",
	compact: "to compact",
	idle_compact: "to compact",
};

/** A new session's opening: the next turn's input is what it got. */
export function startsOver(o: SessionOpening): boolean {
	return o.how === "handoff" || o.how === "summary" || o.how === "load_broken";
}

/** The words after the agent and model: how the session continued (#1166). */
export function sessionHow(o: SessionOpening, names: SessionNames): string {
	const a = names.agent(o.harness);
	switch (o.how) {
		case "resume":
			return "resumed";
		case "load":
			return o.replayed
				? `reloaded, ${o.replayed} earlier ${o.replayed === 1 ? "update" : "updates"} replayed and dropped`
				: "reloaded";
		case "new":
			return "started";
		case "handoff":
			return `handed off${o.from ? ` from ${names.agent(o.from)}` : ""}. It got ${o.carried ?? "the conversation"}.`;
		case "summary":
			return "started fresh with a summary";
		case "load_broken":
			return `${a} can't reload a session reliably, so the conversation was carried over. It got ${o.carried ?? "the conversation"}.`;
	}
}

/** One session boundary (#1166): `Same session · Claude Code · Opus · reloaded`, with its cause. */
export function sessionLine(
	o: SessionOpening,
	names: SessionNames,
	code?: string | null,
): string {
	const same = o.how === "resume" || o.how === "load";
	const parts = [
		same ? "Same session" : "New session",
		names.agent(o.harness),
		...(o.model ? [names.model(o.model)] : []),
		`${sessionHow(o, names)}${code ? `, code at ${code}` : ""}`,
	];
	if (same && o.modelFrom)
		parts.push(
			`switched from ${names.model(o.modelFrom)}; a new model may not reuse the cached context`,
		);
	const cause = CAUSE_WORDS[o.cause];
	if (cause) parts.push(cause);
	return parts.join(" · ");
}
