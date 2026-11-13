// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import {
	Ban,
	CheckCheck,
	CircleCheck,
	CircleDashed,
	CircleHelp,
	Clock3,
	Hourglass,
	type LucideIcon,
	ShieldAlert,
	TriangleAlert,
} from "lucide-react";
import { Ring } from "@/components/shared/Ring";
import { cn } from "@/lib/utils";
import type { ActionId } from "./actions";

/** The closed set of statuses a kit surface shows (pattern sheet §0.6 and §9.1, #1101). */
export type StatusKind =
	| "approval"
	| "question"
	| "limited"
	| "blocked"
	| "failed"
	| "working"
	| "waiting"
	| "done"
	| "settled"
	| "idle";

/**
 * The registered action that fixes a status (#1125). Blocked's depends on its
 * stop mode (`key_rejected`); anything else opens the thread.
 */
export type FixRule =
	| ActionId
	| {
			readonly byCause: Readonly<Record<string, ActionId>>;
			readonly else: ActionId;
	  };

export interface StatusDef {
	word: string;
	icon: string;
	text: string;
	Icon: LucideIcon | null;
	/** Lower comes first wherever statuses are sorted: Home, the list, notifications. */
	urgency: number;
	/** Needs-you statuses only: the one action a card offers. */
	fix?: FixRule;
}

/**
 * Only the icon is tinted (sheet §9.1). Strong colour is for needs-you and
 * failed; working is the accent ring; the rest stay neutral and quiet.
 */
export const STATUS_DEFS: Readonly<Record<StatusKind, StatusDef>> = {
	approval: {
		word: "Approval needed",
		icon: "text-warn",
		text: "text-text-1",
		Icon: ShieldAlert,
		urgency: 0,
		fix: "needs.answer",
	},
	question: {
		word: "Question",
		icon: "text-warn",
		text: "text-text-1",
		Icon: CircleHelp,
		urgency: 0,
		fix: "needs.answer",
	},
	blocked: {
		word: "Blocked",
		icon: "text-danger",
		text: "text-text-1",
		Icon: Ban,
		urgency: 1,
		fix: {
			byCause: {
				key_rejected: "needs.updateKey",
				out_of_credit: "needs.addCredit",
				spend_cap: "needs.raiseCap",
			},
			else: "needs.open",
		},
	},
	failed: {
		word: "Failed",
		icon: "text-danger",
		text: "text-text-1",
		Icon: TriangleAlert,
		urgency: 1,
		fix: "needs.open",
	},
	working: {
		word: "Working",
		icon: "text-accent",
		text: "text-text-2",
		Icon: null,
		urgency: 3,
	},
	// Limited waits on a clock, never on the user: warn on the icon only, never danger (sheet §10).
	limited: {
		word: "Limited",
		icon: "text-warn",
		text: "text-text-2",
		Icon: Clock3,
		urgency: 2,
		fix: "needs.retryNow",
	},
	waiting: {
		word: "Waiting",
		icon: "text-text-3",
		text: "text-text-2",
		Icon: Hourglass,
		urgency: 4,
	},
	done: {
		word: "Done",
		icon: "text-text-3",
		text: "text-text-2",
		Icon: CircleCheck,
		urgency: 5,
	},
	settled: {
		word: "Settled",
		icon: "text-text-3",
		text: "text-text-2",
		Icon: CheckCheck,
		urgency: 6,
	},
	idle: {
		word: "Idle",
		icon: "text-text-3",
		text: "text-text-2",
		Icon: CircleDashed,
		urgency: 6,
	},
};

/** A status as a word, a shape and a colour; the word may be overridden, the shape may not. */
export function Status({
	kind,
	word,
	showWord = true,
	className,
}: {
	kind: StatusKind;
	word?: string;
	showWord?: boolean;
	className?: string;
}) {
	const s = STATUS_DEFS[kind];
	const text = word ?? s.word;
	return (
		<span
			className={cn("inline-flex min-w-0 items-center gap-1.5", className)}
			data-status={kind}
		>
			<span className={cn("flex shrink-0", s.icon)}>
				{s.Icon ? (
					<s.Icon aria-hidden className="size-3.5 stroke-[1.75]" />
				) : (
					<Ring className="size-3.5 text-accent" />
				)}
			</span>
			{showWord ? (
				<span className={cn("truncate font-medium", s.text)}>{text}</span>
			) : (
				<span className="sr-only">{text}</span>
			)}
		</span>
	);
}

export const statusWord = (kind: StatusKind) => STATUS_DEFS[kind].word;

/** Sort key: needs-you first (asks, then stops that broke, then clocks). */
export const statusUrgency = (kind: StatusKind) => STATUS_DEFS[kind].urgency;

/** The action id that fixes this status for this cause, or null when it needs none. */
export function fixActionId(
	kind: StatusKind,
	cause?: string | null,
): ActionId | null {
	const rule = STATUS_DEFS[kind].fix;
	if (!rule) return null;
	if (typeof rule === "string") return rule;
	return (cause && rule.byCause[cause]) || rule.else;
}
