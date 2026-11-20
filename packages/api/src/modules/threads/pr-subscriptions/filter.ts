// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/** Whether one event is for one subscription (#1179 §4.3). Pure. */
import {
	associationRank,
	PR_AUTHOR_LEVEL_RANK,
	PR_EVENT_GROUP_OF,
	type PrSubscriptionSpec,
} from "@prismalens/contracts";
import type { DerivedEvent, EventPayload } from "./derive.js";

export interface FilterContext {
	/** Requested reviewers and authors of any submitted review, lower case. */
	reviewers: ReadonlySet<string>;
}

const AUTHORED = new Set(["comment", "review", "review_comment"]);

/** The spec wants the event's group, or the kind has none. */
export function wants(
	spec: PrSubscriptionSpec,
	kind: DerivedEvent["kind"],
): boolean {
	const group = PR_EVENT_GROUP_OF[kind];
	return group === null || spec.events.includes(group);
}

export function passes(
	spec: PrSubscriptionSpec,
	e: Pick<DerivedEvent, "kind" | "payload">,
	ctx: FilterContext,
): boolean {
	const p = e.payload;
	const f = spec.filter;
	if (AUTHORED.has(e.kind)) {
		const login = p.author?.toLowerCase() ?? "";
		const listed = (l: string[]) => l.some((x) => x.toLowerCase() === login);
		if (login && listed(f.authors.exclude)) return false;
		if (!(login && listed(f.authors.include))) {
			if (p.bot && !f.authors.bots) return false;
			if (f.authors.reviewersOnly && !ctx.reviewers.has(login)) return false;
			const rank = associationRank(p.association);
			// An unknown association passes (D16a): GitLab names none.
			if (
				rank !== null &&
				rank < PR_AUTHOR_LEVEL_RANK[f.authors.minAssociation]
			)
				return false;
		}
		if (e.kind === "review") {
			const v = p.verdict as (typeof f.reviews.verdicts)[number] | undefined;
			if (!v || !f.reviews.verdicts.includes(v)) return false;
		}
		return true;
	}
	if (e.kind === "check") {
		const state = p.check?.state;
		const conclusion =
			state === "failing" || state === "passing" || state === "neutral"
				? state
				: null;
		if (!conclusion || !f.checks.conclusions.includes(conclusion)) return false;
		const name = (p.check?.name ?? "").toLowerCase();
		return (
			!f.checks.names.length ||
			f.checks.names.some((n) => name.includes(n.toLowerCase()))
		);
	}
	if (e.kind === "checks_done") return f.checks.summary;
	if (e.kind === "push") return !f.pushes.forcedOnly || p.forced !== false;
	return true;
}

const TRUSTED = new Set(["OWNER", "MEMBER", "COLLABORATOR"]);

/**
 * A ping-pong item (D8): bot-authored, or agent-posted by a trusted account or one our
 * ledger posts as. An outsider's marker counts as a person's item.
 */
export function isQuiet(
	p: EventPayload,
	ledgerAccounts: ReadonlySet<string>,
): boolean {
	if (p.bot) return true;
	if (!p.agentPosted) return false;
	return (
		(!!p.association && TRUSTED.has(p.association)) ||
		(!!p.author && ledgerAccounts.has(p.author.toLowerCase()))
	);
}
