// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import * as TabsPrimitive from "@radix-ui/react-tabs";
import { Link } from "@tanstack/react-router";
import { X } from "lucide-react";
import { type KeyboardEvent, type ReactNode, useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { WindowControlsSpace } from "./IncidentHeader";
import {
	type DetailLink,
	type DetailRow,
	type DetailSection,
	filterSteps,
	type StepFilter,
} from "./run-details";
import type { RunStep } from "./run-steps";

export type DetailsTab = "summary" | "evidence" | "context" | "steps";

const TONE = {
	ok: "text-ok",
	live: "text-live",
	warn: "text-warn",
	danger: "text-danger",
} as const;

const FILTERS: { id: StepFilter; label: string }[] = [
	{ id: "all", label: "All" },
	{ id: "command", label: "Commands" },
	{ id: "file", label: "Files" },
	{ id: "failed", label: "Failed" },
];

/**
 * The Run details panel (#811): 380 px beside the conversation, never over
 * it; the title row lines up with the header and the tab row with the strip.
 * Esc closes it and the page returns focus to the toggle.
 */
export function RunDetailsPanel({
	title,
	tab,
	onTab,
	onClose,
	incidentId,
	summary,
	evidence,
	context,
	flaggedCount,
	steps,
	onJump,
}: {
	title: string;
	tab: DetailsTab;
	onTab: (tab: DetailsTab) => void;
	onClose: () => void;
	incidentId: string;
	summary: DetailSection[];
	evidence: DetailSection[];
	context: DetailSection[];
	flaggedCount: number;
	steps: RunStep[];
	onJump: (n: number) => void;
}) {
	const [filter, setFilter] = useState<StepFilter>("all");
	const onKeyDown = (e: KeyboardEvent) => {
		if (e.key !== "Escape" || e.defaultPrevented) return;
		e.stopPropagation();
		onClose();
	};
	const shown = filterSteps(steps, filter);
	const tabs: {
		id: DetailsTab;
		label: string;
		aside?: ReactNode;
		aria: string;
	}[] = [
		{ id: "summary", label: "Summary", aria: "Summary" },
		{ id: "evidence", label: "Evidence", aria: "Evidence" },
		{
			id: "context",
			label: "Context",
			aria:
				flaggedCount > 0
					? `Context, ${flaggedCount} flagged ${flaggedCount === 1 ? "item" : "items"}`
					: "Context",
			aside:
				flaggedCount > 0 ? (
					<span
						aria-hidden
						className="ml-1.5 inline-block size-1.5 rounded-full bg-danger"
					/>
				) : null,
		},
		{
			id: "steps",
			label: "Steps",
			aria: `Steps, ${steps.length}`,
			aside: (
				<span aria-hidden className="ml-1.5 text-text-3 tabular-nums">
					{steps.length}
				</span>
			),
		},
	];
	return (
		<aside
			id="run-details"
			aria-label={title}
			onKeyDown={onKeyDown}
			className="flex h-full w-[380px] shrink-0 flex-col bg-surface-1 shadow-[-1px_0_0_var(--hairline)] motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-right-4 motion-safe:duration-200"
			data-testid="run-details"
		>
			<div className="flex h-(--header-h) shrink-0 items-center gap-1.5 px-2 desktop:app-drag desktop:[&_button]:app-no-drag">
				<Button
					variant="text"
					size="icon"
					aria-label="Close details"
					onClick={onClose}
					className="text-text-3"
					data-testid="run-details-close"
				>
					<X className="size-3.5" />
				</Button>
				<h2 className="min-w-0 flex-1 truncate text-heading">{title}</h2>
				<WindowControlsSpace />
			</div>
			<TabsPrimitive.Root
				value={tab}
				onValueChange={(v) => onTab(v as DetailsTab)}
				className="flex min-h-0 flex-1 flex-col"
			>
				<div className="relative flex h-9 shrink-0 items-center px-3 after:absolute after:inset-x-0 after:bottom-0 after:h-px after:bg-hairline">
					<TabsPrimitive.List
						aria-label={title}
						className="flex min-w-0 gap-0.5 self-end"
					>
						{tabs.map((t) => (
							<TabsPrimitive.Trigger
								key={t.id}
								value={t.id}
								aria-label={t.aria}
								className="relative inline-flex h-[26px] items-center rounded-t-control px-2 text-text-2 transition-colors duration-(--dur-instant) hover:text-text-1 data-[state=active]:bg-surface-2 data-[state=active]:text-text-1 data-[state=active]:after:absolute data-[state=active]:after:inset-x-0 data-[state=active]:after:bottom-0 data-[state=active]:after:h-0.5 data-[state=active]:after:bg-accent"
								data-testid={`run-details-tab-${t.id}`}
							>
								{t.label}
								{t.aside}
							</TabsPrimitive.Trigger>
						))}
					</TabsPrimitive.List>
				</div>
				{(["summary", "evidence", "context"] as const).map((id) => (
					<TabsPrimitive.Content
						key={id}
						value={id}
						className="min-h-0 flex-1 overflow-y-auto px-3 pt-3 pb-5"
						data-testid={`run-details-${id}`}
					>
						<Sections
							sections={
								id === "summary"
									? summary
									: id === "evidence"
										? evidence
										: context
							}
							incidentId={incidentId}
							onJump={onJump}
						/>
					</TabsPrimitive.Content>
				))}
				<TabsPrimitive.Content
					value="steps"
					className="flex min-h-0 flex-1 flex-col"
					data-testid="run-details-steps"
				>
					<fieldset
						aria-label="Show"
						className="m-0 flex min-w-0 shrink-0 gap-1 border-0 px-3 pt-2.5 pb-0"
					>
						{FILTERS.map((f) => (
							<button
								key={f.id}
								type="button"
								aria-pressed={f.id === filter}
								onClick={() => setFilter(f.id)}
								className={cn(
									"h-6 rounded-[4px] px-2 text-meta transition-colors duration-(--dur-instant)",
									f.id === filter
										? "bg-surface-3 text-text-1"
										: "text-text-2 hover:text-text-1",
								)}
								data-testid={`steps-filter-${f.id}`}
							>
								{f.label}
							</button>
						))}
					</fieldset>
					<ol className="m-0 min-h-0 flex-1 list-none overflow-y-auto px-3 pt-3 pb-5">
						{shown.length === 0 && (
							<li className="px-2 py-1.5 text-text-2">
								{steps.length === 0
									? "This run ran no tools."
									: "No steps match."}
							</li>
						)}
						{shown.map((s) => (
							<li key={s.callId}>
								<button
									type="button"
									onClick={() => onJump(s.n)}
									className="flex w-full items-baseline gap-2.5 rounded-control px-2 py-1.5 text-left transition-colors duration-(--dur-instant) hover:bg-surface-3"
									data-testid="steps-row"
									data-step={s.n}
								>
									<span className="w-11 shrink-0 text-meta text-text-3">
										Step {s.n}
									</span>
									<span className="flex min-w-0 flex-1 flex-col">
										<span
											className={cn(
												"truncate",
												s.ok === false ? "text-danger" : "text-text-1",
											)}
										>
											{s.title}
										</span>
										{s.title !== s.command && (
											<span className="truncate font-mono text-mono text-text-3">
												{s.command}
											</span>
										)}
									</span>
									<span className="shrink-0 text-meta text-text-3 tabular-nums">
										{clock(s.at)}
									</span>
								</button>
							</li>
						))}
					</ol>
				</TabsPrimitive.Content>
			</TabsPrimitive.Root>
		</aside>
	);
}

const clockFmt = new Intl.DateTimeFormat(undefined, {
	hour: "2-digit",
	minute: "2-digit",
	second: "2-digit",
	hour12: false,
});
const clock = (at: string) => clockFmt.format(new Date(at));

function Sections({
	sections,
	incidentId,
	onJump,
}: {
	sections: DetailSection[];
	incidentId: string;
	onJump: (n: number) => void;
}) {
	return (
		<div className="flex flex-col gap-4">
			{sections.map((sec) => (
				<section key={sec.title} className="flex flex-col gap-1.5">
					<h3 className="text-meta font-semibold text-text-2">{sec.title}</h3>
					{sec.rows.map((row, i) => (
						<Row
							// biome-ignore lint/suspicious/noArrayIndexKey: rows are positional within a section and never reorder.
							key={i}
							row={row}
							incidentId={incidentId}
							onJump={onJump}
						/>
					))}
				</section>
			))}
		</div>
	);
}

function Row({
	row,
	incidentId,
	onJump,
}: {
	row: DetailRow;
	incidentId: string;
	onJump: (n: number) => void;
}) {
	return (
		<div
			className={cn(
				"flex items-start gap-2",
				row.box === "danger" &&
					"rounded-surface bg-[oklch(from_var(--danger)_l_c_h/0.14)] px-2.5 py-2",
			)}
			data-testid="detail-row"
		>
			{row.label && (
				<span className="w-[88px] shrink-0 text-meta leading-5 text-text-3">
					{row.label}
				</span>
			)}
			<span className="flex min-w-0 flex-1 flex-col gap-0.5">
				<span
					dir="auto"
					className={cn(
						row.tone ? TONE[row.tone] : "text-text-1",
						row.mono
							? "font-mono text-mono leading-5 [overflow-wrap:anywhere]"
							: "[overflow-wrap:anywhere]",
						row.strong && "font-semibold",
					)}
				>
					{row.text}
				</span>
				{row.sub && (
					<span
						dir="auto"
						className={cn(
							"text-meta [overflow-wrap:anywhere]",
							row.box ? "text-text-1" : "text-text-3",
						)}
					>
						{row.sub}
					</span>
				)}
				{row.link && (
					<LeaveLink link={row.link} incidentId={incidentId}>
						{row.action ?? "Open"}
					</LeaveLink>
				)}
			</span>
			{row.step !== undefined && (
				<button
					type="button"
					onClick={() => onJump(row.step as number)}
					aria-label={`Show step ${row.step} in the transcript`}
					className="h-[22px] shrink-0 rounded-full bg-surface-3 px-2 text-meta text-accent transition-colors duration-(--dur-instant) hover:bg-surface-4"
					data-testid="detail-step"
				>
					Step {row.step}
				</button>
			)}
		</div>
	);
}

/**
 * A link that leaves the page: underlined accent text, never a chip, so it
 * reads apart from a step jump's pill, which stays on the page (#811).
 */
function LeaveLink({
	link,
	incidentId,
	children,
}: {
	link: DetailLink;
	incidentId: string;
	children: ReactNode;
}) {
	const cls =
		"self-start text-meta text-accent underline underline-offset-[3px] decoration-[oklch(from_var(--accent)_l_c_h/0.4)] hover:decoration-current";
	if (link.kind === "overview")
		return (
			<Link
				to="/incidents/$id"
				params={{ id: incidentId }}
				hash="stop-the-impact"
				className={cls}
				data-testid="detail-link"
			>
				{children}
			</Link>
		);
	if (link.kind === "run")
		return (
			<Link
				to="/incidents/$id/conversation"
				params={{ id: incidentId }}
				search={{ investigation: link.id }}
				className={cls}
				data-testid="detail-link"
			>
				{children}
			</Link>
		);
	return (
		<Link
			to="/settings"
			search={{ tab: link.section === "agent" ? "harness" : "integrations" }}
			className={cls}
			data-testid="detail-link"
		>
			{children}
		</Link>
	);
}
