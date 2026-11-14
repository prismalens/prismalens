// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import {
	type CanonicalEvent,
	type PrStatusMark,
	prHostTerms,
	prLabel,
} from "@prismalens/contracts";
import { useNavigate } from "@tanstack/react-router";
import { SquareArrowOutUpRight } from "lucide-react";
import { markLook } from "@/components/kit/marks";
import { Hint } from "@/components/shared/Hint";
import {
	checksParts,
	checksTitle,
	PR_TONE_WORD,
} from "@/components/thread/panel/PullRequests";
import { cn } from "@/lib/utils";
import type { TranscriptNodeProps } from "./types";

type PrStatus = Extract<CanonicalEvent, { kind: "pr_status" }>;

/** Past this many changes in one event, the rest fold into "+N". */
const SHOWN = 4;
const ICON = "size-3.5 shrink-0 stroke-[1.75]";

/** A reviewer's initial in a round chip; the host's avatar image is not fetched. */
function Initial({ name }: { name: string }) {
	return (
		<span
			aria-hidden
			className="inline-flex size-4 shrink-0 items-center justify-center rounded-full bg-surface-3 text-[10px] leading-none font-medium text-text-2"
		>
			{name.replace(/^@/, "").charAt(0).toUpperCase() || "?"}
		</span>
	);
}

/** One change as marks: a check's result and short SHA, a reviewer and verdict, a conflict, the end. */
function ChangeMark({ mark }: { mark: PrStatusMark }) {
	if (mark.kind === "check") {
		const look = markLook("checks", mark.state);
		return (
			<span
				className="inline-flex shrink-0 items-center gap-1"
				data-mark="checks"
				data-state={mark.state}
			>
				<look.icon aria-hidden className={cn(ICON, look.className)} />
				{mark.sha && <span className="font-mono text-text-2">{mark.sha}</span>}
			</span>
		);
	}
	if (mark.kind === "review" || mark.kind === "comment") {
		const look = markLook("review", mark.state ?? "commented");
		return (
			<span
				className="inline-flex shrink-0 items-center gap-1"
				data-mark="review"
				data-state={mark.state}
			>
				{mark.name && <Initial name={mark.name} />}
				<look.icon aria-hidden className={cn(ICON, look.className)} />
			</span>
		);
	}
	const look =
		mark.kind === "conflict"
			? markLook("conflict", "conflict")
			: markLook("changeRequest", mark.state);
	return (
		<span
			className="inline-flex shrink-0"
			data-mark={mark.kind}
			data-state={mark.state}
		>
			<look.icon aria-hidden className={cn(ICON, look.className)} />
		</span>
	);
}

/**
 * A pushed PR status (#1101, sheet §0.7): one line of marks, the PR glyph in its
 * state's colour, the checks fraction, then each change. The sentence is the hint
 * and the accessible name; the line opens the PR view on its checks.
 */
export function PrStatusNode({ event }: TranscriptNodeProps) {
	const e = event as PrStatus;
	const number = Number(e.pr.split("#").pop());
	const tone = e.tone ?? "unknown";
	const terms = prHostTerms(e.host);
	const navigate = useNavigate();
	const pr = Number.isFinite(number) ? prLabel(e.host, number) : e.pr;
	// Words, not `7/9`: what fails and what runs, every count in the hint (#1101 cat 15).
	const fraction = e.checks
		? (checksParts(e.checks)
				?.map((p) => p.text)
				.join(" · ") ?? null)
		: null;
	const head = [
		pr,
		e.tone && PR_TONE_WORD[e.tone],
		e.checks && checksTitle(e.checks, terms),
	]
		.filter(Boolean)
		.join(", ");
	const sentence = `${head}: ${e.lines.join("; ")}`;
	const marks = (e.marks ?? []).filter((m): m is PrStatusMark => !!m);
	const more = e.lines.length - Math.min(marks.length, SHOWN);
	const glyph = markLook("changeRequest", tone);
	const checks = e.checks && markLook("checks", e.checks.state);
	const ended =
		e.phase === "ended" && !marks.length ? markLook("watch", "stopped") : null;
	const line = (
		<Hint label={sentence}>
			<button
				type="button"
				aria-label={sentence}
				onClick={() =>
					void navigate({
						to: ".",
						search: (s: Record<string, unknown>) => ({
							...s,
							panel: "thread" as const,
							section: `pull-requests:${e.prId}`,
						}),
					})
				}
				className="flex min-w-0 items-center gap-2 rounded-control text-meta text-text-2 tabular-nums outline-none hover:text-text-1 focus-visible:ring-2 focus-visible:ring-accent"
				data-testid="pr-status-line"
				data-tone={tone}
			>
				<span
					className="inline-flex shrink-0 items-center gap-1"
					data-mark="changeRequest"
				>
					<glyph.icon aria-hidden className={cn(ICON, glyph.className)} />
					<span className="text-text-1">
						{terms.numberPrefix}
						{Number.isFinite(number) ? number : e.pr}
					</span>
				</span>
				{checks && fraction && (
					<span
						className={cn(
							"inline-flex shrink-0 items-center gap-1",
							checks.className,
						)}
						data-mark="checks"
						data-state={e.checks?.state}
						data-testid="pr-status-checks"
					>
						<checks.icon aria-hidden className={ICON} />
						{fraction}
					</span>
				)}
				{marks.slice(0, SHOWN).map((m, i) => (
					// Marks are positional with `lines`; nothing reorders them.
					// biome-ignore lint/suspicious/noArrayIndexKey: see above
					<ChangeMark key={i} mark={m} />
				))}
				{ended && (
					<ended.icon aria-hidden className={cn(ICON, ended.className)} />
				)}
				{marks.length > 0 && more > 0 && (
					<span className="text-text-3">+{more}</span>
				)}
			</button>
		</Hint>
	);
	// A line about one comment links it beside the button, never inside it.
	if (!e.link) return line;
	return (
		<span className="flex min-w-0 items-center gap-2">
			{line}
			<a
				href={e.link}
				target="_blank"
				rel="noreferrer"
				aria-label="Open the comment on the code host"
				className="shrink-0 text-text-3 hover:text-text-1"
				data-testid="pr-status-link"
			>
				<SquareArrowOutUpRight aria-hidden className={ICON} />
			</a>
		</span>
	);
}
