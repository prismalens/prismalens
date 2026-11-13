// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { PrTone } from "@prismalens/contracts";
import { Flag, GitBranch } from "lucide-react";
import type { ReactNode } from "react";
import { AgentMark as AgentGlyph } from "@/components/agent/AgentMark";
import { Hint } from "@/components/shared/Hint";
import { cn } from "@/lib/utils";
import { MARKS, markLook } from "./marks";

/**
 * The closed set of metadata marks (pattern sheet §0.7, #1101): agent, branch, change
 * request by state, who started it, risk. Each is a shape plus its word in a hint and an
 * accessible label; colour only ever repeats what the shape and the label say.
 */
const MARK = "inline-flex min-w-0 items-center gap-1 text-meta tabular-nums";

function Mark({
	label,
	children,
	className,
	testId,
}: {
	label: string;
	children: ReactNode;
	className?: string;
	testId?: string;
}) {
	return (
		<Hint label={label}>
			<span
				role="img"
				aria-label={label}
				className={cn(MARK, className)}
				data-testid={testId}
			>
				{children}
			</span>
		</Hint>
	);
}

/** "feat/w2-cl…climb": the branch cut in the middle, keeping its prefix and its end. */
export function middleCut(text: string, max = 22): string {
	if (text.length <= max) return text;
	const head = Math.ceil((max - 1) / 2);
	return `${text.slice(0, head)}…${text.slice(text.length - (max - 1 - head))}`;
}

/** The branch: an icon and the name, never coloured. */
export function BranchMark({ branch }: { branch: string }) {
	return (
		<Mark
			label={`Branch ${branch}`}
			className="min-w-0 shrink text-text-3"
			testId="mark-branch"
		>
			<GitBranch aria-hidden className="size-3 shrink-0" />
			<span className="truncate font-mono">{middleCut(branch)}</span>
		</Mark>
	);
}

/** A change request: its glyph and number in its state's colour, "+N" for more. */
export function PrMark({
	number,
	tone,
	count = 1,
	prefix = "#",
	noun = "Pull request",
}: {
	number: number;
	tone: PrTone;
	count?: number;
	/** The host's number prefix: `#`, or `!` for a merge request. */
	prefix?: string;
	noun?: string;
}) {
	const g = markLook("changeRequest", tone);
	const more = count > 1 ? count - 1 : 0;
	return (
		<Mark
			label={`${noun} ${prefix}${number}, ${g.word ?? tone}${more ? `, and ${more} more` : ""}`}
			className={cn("shrink-0", g.className)}
			testId="mark-pr"
		>
			<g.icon aria-hidden className="size-3 shrink-0" />
			<span>
				{prefix}
				{number}
			</span>
			{more > 0 && <span className="text-text-3">+{more}</span>}
		</Mark>
	);
}

/** Who started a thread, in the startedBy mark's words in its hint (#1101 cat 10). */
export function StartedByMark({
	by,
}: {
	by: { title: string | null; via: "agent" | "fork" };
}) {
	const Icon = MARKS.startedBy.icons[by.via];
	return (
		<Mark
			label={startedByLabel(by)}
			className="shrink-0 text-text-3"
			testId="mark-started-by"
		>
			<Icon aria-hidden className="size-3 shrink-0" data-via={by.via} />
		</Mark>
	);
}

export const startedByLabel = (by: {
	title: string | null;
	via: "agent" | "fork";
}) => `${MARKS.startedBy.words[by.via]} ${by.title?.trim() || "a thread"}`;

/** The agent: its real mark, the model in the hint. */
export function AgentBadge({
	agent,
	label,
	model,
}: {
	agent: string;
	label: string;
	model?: string | null;
}) {
	return (
		<Mark
			label={model ? `${label} · ${model}` : label}
			className="shrink-0"
			testId="mark-agent"
		>
			<AgentGlyph id={agent} className="size-3.5" />
		</Mark>
	);
}

/** A risk the change carries: tests, CI, migrations and the rest (#1110). */
export function RiskMark({ label }: { label: string }) {
	return (
		<Mark label={label} className="shrink-0 text-warn" testId="mark-risk">
			<Flag aria-hidden className="size-3 shrink-0" />
		</Mark>
	);
}
