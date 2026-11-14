// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type {
	PrTone,
	ThreadContext,
	ThreadLink,
	ThreadLinks,
} from "@prismalens/contracts";
import type { ReactNode } from "react";
import type { Details, DetailsPr } from "@/components/kit/details-registry";
import {
	checksParts,
	MERGE_WORD,
	PR_TONE_WORD,
	type PullRequestView,
	REVIEW_WORD,
} from "./PullRequests";

type Opener = () => void;

const OS_WORD: Record<ThreadContext["machine"]["os"], string> = {
	windows: "Windows",
	macos: "macOS",
	linux: "Linux",
	other: "",
};

/** The card's PR tone: only failing and needs-attention carry colour (sheet §9.1). */
function prTone(pr: PullRequestView): DetailsPr["tone"] {
	const byTone: Record<PrTone, DetailsPr["tone"]> = {
		failing: "failing",
		attention: "attention",
		merged: "merged",
		closed: "merged",
		ready: "passing",
		open: "passing",
		draft: "passing",
		unknown: "passing",
	};
	return pr.checks.pending > 0 && pr.tone !== "failing"
		? "running"
		: byTone[pr.tone];
}

function prOf(pr: PullRequestView | undefined): DetailsPr | undefined {
	if (!pr) return undefined;
	const c = pr.checks;
	const counted = c.total > 0 && c.state !== "none" && c.state !== "unknown";
	const review = REVIEW_WORD[pr.review];
	const mergeState =
		pr.mergeState ?? (pr.conflicts === true ? "conflicts" : undefined);
	const merge =
		pr.state === "open" && mergeState ? MERGE_WORD[mergeState] : null;
	return {
		number: pr.number,
		word: PR_TONE_WORD[pr.tone],
		tone: prTone(pr),
		...(counted
			? {
					checks: (checksParts(c) ?? []).map((p) => p.text).join(" · "),
				}
			: {}),
		...(pr.title ? { title: pr.title } : {}),
		...(pr.headRef && pr.baseRef
			? { branches: { head: pr.headRef, base: pr.baseRef } }
			: {}),
		...(review ? { review: { state: pr.review, word: review } } : {}),
		...(merge && mergeState
			? { merge: { state: mergeState, word: merge[0] } }
			: {}),
	};
}

/**
 * The details card's data for a thread (sheet §3): what the registry draws,
 * from the context and the start links the panel already loads.
 */
export function detailsOf(o: {
	context: ThreadContext;
	links: ThreadLinks | undefined;
	agentLabel: string | null;
	/** The card's git action and openers, drawn by the caller. */
	actions?: ReactNode;
	/** The static list of the threads it started. */
	started?: (started: ThreadLink[]) => { node: ReactNode; span: number };
	open: {
		diff?: Opener;
		pr?: Opener;
		startedBy?: Opener;
		kind?: Opener;
	};
}): Details {
	const { context, links, open } = o;
	const pr = prOf(context.pullRequests[0] as PullRequestView | undefined);
	if (context.kind === "incident") {
		const sev = context.incident.severity;
		const firing =
			context.incident.alertCount > 0 && context.incident.status !== "resolved";
		const cause = context.suspects[0]?.statement;
		return {
			kind: "incident",
			severity: {
				word: sev.charAt(0).toUpperCase() + sev.slice(1),
				tone:
					sev === "critical"
						? "danger"
						: sev === "high"
							? "sev-high"
							: sev === "medium"
								? "warn"
								: "sev-low",
			},
			...(cause ? { cause } : {}),
			...(context.incident.alertCount > 0
				? { alert: { name: context.incident.title, firing } }
				: {}),
			...(pr ? { pr } : {}),
			open: { alert: open.kind, pr: open.pr },
		};
	}
	const repos = context.workspace?.repos ?? [];
	const branchRepo = repos.find((r) => r.branch);
	const branch = branchRepo?.branch ?? undefined;
	const sync =
		branchRepo &&
		typeof branchRepo.ahead === "number" &&
		typeof branchRepo.behind === "number"
			? { ahead: branchRepo.ahead, behind: branchRepo.behind }
			: undefined;
	const counted = repos.filter(
		(r) => r.additions !== null && r.deletions !== null,
	);
	const by = links?.startedBy ?? null;
	const started = links?.started ?? [];
	const os = OS_WORD[context.machine.os];
	return {
		kind: "thread",
		machine: os
			? `${context.machine.hostName} · ${os}`
			: context.machine.hostName,
		agent: {
			id: context.agent.harness ?? "unknown",
			name: o.agentLabel ?? context.agent.harness ?? "Agent",
			...(context.agent.model ? { model: context.agent.model } : {}),
		},
		...(branch ? { branch } : {}),
		...(sync ? { sync } : {}),
		...(o.actions ? { actions: o.actions } : {}),
		...(o.started && started.length ? { started: o.started(started) } : {}),
		...(counted.length
			? {
					changes: {
						added: counted.reduce((n, r) => n + (r.additions ?? 0), 0),
						removed: counted.reduce((n, r) => n + (r.deletions ?? 0), 0),
					},
				}
			: {}),
		...(pr ? { pr } : {}),
		...(by ? { startedBy: { title: by.title ?? "Thread", via: by.via } } : {}),
		...(context.kind === "schedule" ? { schedule: context.schedule.name } : {}),
		open: {
			diff: open.diff,
			pr: open.pr,
			startedBy: by ? open.startedBy : undefined,
		},
	};
}
