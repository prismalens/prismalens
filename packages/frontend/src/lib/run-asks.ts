// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type {
	CanonicalEvent,
	PermissionAskOutcome,
} from "@prismalens/contracts";
import type { RunStep } from "@/components/run/run-steps";
import { mcpTool, shortPath } from "./report-view";

/** An ask's standing: waiting on you, how it ended, or `ended` when the run ended first (#673 w21). */
export type AskState = "waiting" | PermissionAskOutcome | "ended";

/** One of the agent's asks, as the dock and its step show it (#820). */
export interface AskRecord {
	askId: string;
	title: string;
	/** The command or path it names. */
	detail: string | null;
	/** The call's input as JSON when it names neither (an MCP tool). */
	input: string | null;
	/** The MCP server the tool comes from. */
	server: string | null;
	at: string;
	expiresAt: string;
	clamped: boolean;
	state: AskState;
	/** The step it asked about; none when the agent named no call the run made. */
	step?: number;
}

/** How an ask ended, in one line (#673 w21). */
export const ASK_END: Record<Exclude<AskState, "waiting">, string> = {
	approved: "You approved it",
	denied: "You denied it",
	timed_out: "No one answered in 10 minutes, so it was denied",
	stopped: "Denied: the run stopped",
	restarted: "Denied: PrismaLens restarted",
	ended: "Not answered before the run ended",
	allowed: "Allowed by the run's permission level",
	mode_kept: "Refused: the run keeps its mode",
	unattended: "Refused: an alert started this run and nobody was there",
};

export function askEnd(ask: Pick<AskRecord, "state" | "clamped">): string {
	if (ask.state === "waiting") return "Waiting for your approval";
	if (ask.state === "timed_out" && ask.clamped)
		return "Denied: the run's time limit was reached";
	return ASK_END[ask.state];
}

/** The verb of a step its ask refused, in place of "Failed" (#673 w8-18); null when the ask let it run. */
export function refusedVerb(state: AskState): string | null {
	if (state === "denied") return "Denied by you";
	if (state === "timed_out" || state === "stopped" || state === "restarted")
		return "Denied";
	if (state === "mode_kept" || state === "unattended") return "Refused";
	return null;
}

const same = (s: string, cwd?: string | null) =>
	shortPath(s, cwd).replace(/\s+/g, " ").trim().toLowerCase();

/**
 * Every ask the agent made that waited on you (#820), each tied to its step:
 * by the call id the ask names, else (asks stored before it did) the one
 * earlier step running the same command. Asks the level answered at once never
 * waited and are not here.
 */
export function deriveAsks(
	events: readonly CanonicalEvent[],
	steps: readonly RunStep[],
	opts: { live: boolean; cwd?: string | null },
): AskRecord[] {
	const asks = new Map<string, AskRecord & { call?: string }>();
	const endTurn = () => {
		for (const ask of Array.from(asks.values()))
			if (ask.state === "waiting") ask.state = "ended";
	};
	for (const e of events) {
		// The turn an ask waited in ended without its answer: a follow-up must not revive it.
		if (
			e.kind === "error" ||
			e.kind === "report" ||
			e.kind === "branch_done" ||
			(e.kind === "operator_message" && e.resumed)
		)
			endTurn();
		else if (e.kind === "permission_ask")
			asks.set(e.askId, {
				askId: e.askId,
				title: e.title,
				detail: e.detail,
				input: e.input ?? null,
				server: e.server ?? null,
				at: e.ts,
				expiresAt: e.expiresAt,
				clamped: e.clamped === true,
				state: "waiting",
				...(e.toolCallId ? { call: e.toolCallId } : {}),
			});
		else if (e.kind === "permission_answer") {
			const ask = asks.get(e.askId);
			if (ask) ask.state = e.outcome;
		}
	}
	return Array.from(asks.values()).map(({ call, ...ask }) => {
		const state = !opts.live && ask.state === "waiting" ? "ended" : ask.state;
		const step = call
			? steps.find((s) => s.callId === call)?.n
			: oldAskStep(ask, steps, opts.cwd);
		return { ...ask, state, ...(step !== undefined ? { step } : {}) };
	});
}

function oldAskStep(
	ask: Pick<AskRecord, "detail" | "at">,
	steps: readonly RunStep[],
	cwd?: string | null,
): number | undefined {
	if (!ask.detail) return undefined;
	const want = same(ask.detail, cwd);
	const hits = steps.filter(
		(s) => s.at <= ask.at && same(s.command, cwd).endsWith(want),
	);
	return hits.length === 1 ? hits[0]?.n : undefined;
}

/** What an ask wants to run, as one line: the tool and its server for an MCP call. */
export function askTitle(ask: Pick<AskRecord, "title" | "server">): string {
	const mcp = mcpTool(ask.title);
	if (!mcp) return ask.title;
	return `${mcp.tool}, a tool from the ${ask.server ?? mcp.server} MCP server`;
}
