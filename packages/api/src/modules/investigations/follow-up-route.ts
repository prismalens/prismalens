// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import {
	type AccessLevel,
	HARNESS_IDS,
	HARNESS_REGISTRY,
	type HarnessId,
	reopens,
} from "@prismalens/config/harness";
import type { HarnessSelection } from "@prismalens/config/harness-selection";
import type {
	FollowUpRoute,
	HarnessProbeOutcome,
	RunChoice,
} from "@prismalens/contracts";
import { z } from "zod";

/** One agent's own session in a thread (#1168); `seenSeq` null until its seed or first prompt landed. */
const AgentSessionSchema = z.object({
	acpSessionId: z.string().nullable(),
	seenSeq: z.number().int().nullable(),
	/** Prompts this session answered with a stop other than cancelled. */
	receipts: z.number().int().nonnegative().default(0),
	/** The tail of its last answered prompt, which a reload's replay must end with. */
	checkpoint: z.string().nullable().default(null),
	model: z.string().nullable(),
	effort: z.string().nullable(),
	/** It started work on its own when reopened: it gets handoffs from then on. */
	noReturn: z.boolean().optional(),
});
export type AgentSession = z.infer<typeof AgentSessionSchema>;
export type AgentSessions = Partial<Record<HarnessId, AgentSession>>;

/** The stored map; an unparsable or missing column is no entries. */
export function agentSessionsOf(
	json: string | null | undefined,
): AgentSessions {
	if (!json) return {};
	try {
		const raw = JSON.parse(json) as Record<string, unknown>;
		const out: AgentSessions = {};
		for (const h of HARNESS_IDS) {
			const parsed = AgentSessionSchema.safeParse(raw?.[h]);
			if (parsed.success) out[h] = parsed.data;
		}
		return out;
	} catch {
		return {};
	}
}

/**
 * Agents never returned to: reopening their session can start work before
 * PrismaLens applies the level. codex-acp 2.6.0 tracks a goal turn Codex
 * auto-starts on thread/resume and thread/load (src/CodexAcpServer.ts:1305, :1657, :1936).
 */
export const NO_RETURN: Partial<Record<HarnessId, string>> = {
	codex: "codex-acp 2.6.0 auto-starts a stored goal turn on resume or load",
};

/** Whether a send to `harness` can go back to its own session, or why it hands off instead. */
function returnable(
	entry: AgentSession | undefined,
	harness: HarnessId,
	to: Pick<RunChoice, "model" | "effort">,
): true | "autonomous" | "default" | null {
	if (!entry?.acpSessionId || !reopens(HARNESS_REGISTRY[harness])) return null;
	if (NO_RETURN[harness] || entry.noReturn) return "autonomous";
	// The agent's default can't be put back on a session that ran a named value.
	if (
		(to.model === null && entry.model) ||
		(to.effort === null && entry.effort)
	)
		return "default";
	return true;
}

/**
 * Where a finished run's follow-up goes: the run's own session when the same
 * agent can load it, back to another agent's own session it left here (#1168),
 * else a fresh session of the chosen agent seeded by a handoff. Null when the
 * run names no agent and none was chosen.
 */
export function followUpRoute(
	inv: {
		harness: string | null;
		acpSessionId: string | null;
		agentSessions?: string | null;
	},
	chosen?: HarnessId,
	to: Pick<RunChoice, "model" | "effort"> = {},
): {
	route: FollowUpRoute;
	harness: HarnessId;
	noReturn?: "autonomous" | "default";
} | null {
	const own = HARNESS_IDS.find((h) => h === inv.harness);
	const harness = chosen ?? own;
	if (!harness) return null;
	const sessions = agentSessionsOf(inv.agentSessions);
	if (harness === own) {
		const loads = !!inv.acpSessionId && reopens(HARNESS_REGISTRY[harness]);
		// A session that started work on its own when reopened is never reopened again.
		const tripped =
			sessions[harness]?.noReturn &&
			sessions[harness]?.acpSessionId === inv.acpSessionId;
		if (loads && tripped)
			return { route: "handoff", harness, noReturn: "autonomous" };
		return { route: loads ? "load" : "handoff", harness };
	}
	const back = returnable(sessions[harness], harness, to);
	if (back === true) return { route: "return", harness };
	return { route: "handoff", harness, ...(back ? { noReturn: back } : {}) };
}

/** Each agent's own session for the thread's record (#1168); never the checkpoint text. */
export function sessionsOf(inv: {
	harness: string | null;
	agentSessions?: string | null;
}): Array<{
	harness: string;
	seenSeq: number | null;
	current: boolean;
	returnable: boolean;
}> {
	return Object.entries(agentSessionsOf(inv.agentSessions)).map(
		([harness, e]) => ({
			harness,
			seenSeq: e.seenSeq,
			current: harness === inv.harness,
			returnable: returnable(e, harness as HarnessId, {}) === true,
		}),
	);
}

/** What stops the recipient taking the handoff, and the fix; null when it can. */
export function handoffPreflight(
	harness: HarnessId,
	selection: HarnessSelection,
	checked: HarnessProbeOutcome | null,
): { problem: string; fix: string } | null {
	const row = HARNESS_REGISTRY[harness];
	if (!selection.runnable)
		return {
			problem: selection.reason,
			fix:
				selection.failure === "model-unsupported"
					? "Pick another model on the model chip."
					: selection.failure === "env-pinned-other"
						? "Unset PRISMALENS_HARNESS, or pick the agent it names."
						: `Install it (${row.install}), or pick another agent.`,
		};
	if (checked === "sign-in-needed")
		return {
			problem: `${row.label} is not signed in.`,
			fix: `Sign in: ${row.loginHint}.`,
		};
	return null;
}

/** A handoff keeps the run's level; a run from before levels gets the narrowest. */
export function inheritedLevel(level: AccessLevel | undefined): AccessLevel {
	return level ?? "supervised";
}
