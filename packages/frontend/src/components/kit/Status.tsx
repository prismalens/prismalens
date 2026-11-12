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
 * Only the icon is tinted (sheet §9.1). Strong colour is for needs-you and
 * failed; working is the accent ring; the rest stay neutral and quiet.
 */
const STATUS: Record<
	StatusKind,
	{ word: string; icon: string; text: string; Icon: LucideIcon | null }
> = {
	approval: {
		word: "Approval needed",
		icon: "text-warn",
		text: "text-text-1",
		Icon: ShieldAlert,
	},
	question: {
		word: "Question",
		icon: "text-warn",
		text: "text-text-1",
		Icon: CircleHelp,
	},
	blocked: {
		word: "Blocked",
		icon: "text-danger",
		text: "text-text-1",
		Icon: Ban,
	},
	failed: {
		word: "Failed",
		icon: "text-danger",
		text: "text-text-1",
		Icon: TriangleAlert,
	},
	working: {
		word: "Working",
		icon: "text-accent",
		text: "text-text-2",
		Icon: null,
	},
	limited: {
		word: "Limited",
		icon: "text-text-2",
		text: "text-text-2",
		Icon: Clock3,
	},
	waiting: {
		word: "Waiting",
		icon: "text-text-3",
		text: "text-text-2",
		Icon: Hourglass,
	},
	done: {
		word: "Done",
		icon: "text-text-3",
		text: "text-text-2",
		Icon: CircleCheck,
	},
	settled: {
		word: "Settled",
		icon: "text-text-3",
		text: "text-text-2",
		Icon: CheckCheck,
	},
	idle: {
		word: "Idle",
		icon: "text-text-3",
		text: "text-text-2",
		Icon: CircleDashed,
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
	const s = STATUS[kind];
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

export const statusWord = (kind: StatusKind) => STATUS[kind].word;
