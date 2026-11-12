// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type {
	ReferenceHit,
	ReferenceSearchResult,
	ReferenceTrigger,
} from "@prismalens/contracts";
import { Link } from "@tanstack/react-router";
import {
	Bell,
	BellOff,
	BookOpen,
	CircleDot,
	Clock,
	FileText,
	Folder,
	FolderGit2,
	GitPullRequest,
	ListChecks,
	type LucideIcon,
	MessageSquare,
	Package,
	Paperclip,
	Server,
	Siren,
	SquareSlash,
} from "lucide-react";
import { Ring } from "@/components/shared/Ring";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { AGENT_ROWS_UNTYPED } from "./trigger";

export interface MenuGroup {
	label: string;
	hits: ReferenceHit[];
	/** Rows left out until the user types (the agent's long command list). */
	more: number;
}

/** The app's own commands; groups are named by type, never by brand (sheet §5). */
const APP_GROUP = "Commands";

/**
 * The hits as the menu shows them (#1024): one labelled group per source, in rank
 * order; under `/` PrismaLens's own commands come first, and an agent group shows
 * five rows until the user types.
 */
export function groupHits(
	hits: readonly ReferenceHit[],
	trigger: ReferenceTrigger,
	query: string,
): MenuGroup[] {
	const groups = new Map<string, ReferenceHit[]>();
	for (const h of hits) {
		const label = h.group ?? APP_GROUP;
		groups.set(label, [...(groups.get(label) ?? []), h]);
	}
	const out = Array.from(groups).map(([label, list]) => {
		const capped =
			trigger === "/" && !query && list[0]?.source === "agent"
				? list.slice(0, AGENT_ROWS_UNTYPED)
				: list;
		return { label, hits: capped, more: list.length - capped.length };
	});
	if (trigger === "/")
		out.sort(
			(a, b) => Number(b.label === APP_GROUP) - Number(a.label === APP_GROUP),
		);
	return out;
}

/** The rows in keyboard order, across groups. */
export const menuRows = (groups: readonly MenuGroup[]) =>
	groups.flatMap((g) => g.hits);

const WHY: Record<ReferenceHit["why"], string | null> = {
	used: "Recent",
	agent: "Agent used",
	open: "Open",
	match: null,
};

export const optionId = (i: number) => `composer-menu-option-${i}`;

/** Each row's type icon (#1101 category 6 item 1): what a hit is, before its title. */
const KIND_ICON: Record<ReferenceHit["ref"]["kind"], LucideIcon> = {
	file: FileText,
	folder: Folder,
	service: Server,
	project: FolderGit2,
	attachment: Paperclip,
	artifact: Package,
	runbook: BookOpen,
	thread: MessageSquare,
	incident: Siren,
	schedule: Clock,
	pull_request: GitPullRequest,
	issue: CircleDot,
	alert: Bell,
	silence: BellOff,
	alert_rule: ListChecks,
	command: SquareSlash,
};

/** The one menu for `/`, `@` and `#`, at the box. Focus stays in the box (combobox). */
export function ComposerMenu({
	trigger,
	query,
	result,
	loading,
	failed,
	active,
	onActive,
	onPick,
}: {
	trigger: ReferenceTrigger;
	query: string;
	result: ReferenceSearchResult | undefined;
	loading: boolean;
	failed: string | null;
	active: number;
	onActive: (i: number) => void;
	onPick: (hit: ReferenceHit) => void;
}) {
	const groups = result ? groupHits(result.hits, trigger, query) : [];
	const unavailable = result?.unavailable ?? [];
	const empty = !!result && groups.length === 0;
	let row = -1;
	return (
		<div
			className="floating flex max-h-72 flex-col overflow-y-auto rounded-pool p-1"
			data-testid="composer-menu"
			data-trigger={trigger}
		>
			{/* biome-ignore lint/a11y/useSemanticElements: a combobox popup is a listbox (WAI-ARIA APG). */}
			<div role="listbox" id="composer-menu" aria-label="Suggestions">
				{groups.map((g) => (
					// biome-ignore lint/a11y/useSemanticElements: listbox groups are role=group.
					<div
						key={g.label}
						role="group"
						aria-label={g.label}
						data-testid="composer-menu-group"
						data-group={g.label}
					>
						<div className="px-2.5 pt-1.5 pb-1 text-meta text-text-3">
							{g.label}
						</div>
						{g.hits.map((h) => {
							row++;
							const i = row;
							const why = WHY[h.why];
							const Icon = KIND_ICON[h.ref.kind];
							return (
								<div
									key={`${h.ref.kind}:${h.ref.id}`}
									id={optionId(i)}
									role="option"
									aria-selected={i === active}
									tabIndex={-1}
									onMouseDown={(e) => e.preventDefault()}
									onMouseMove={() => i !== active && onActive(i)}
									onClick={() => onPick(h)}
									onKeyDown={() => {}}
									className={cn(
										"flex min-h-8 cursor-default items-center gap-2 rounded-control px-2.5 text-body text-text-1",
										i === active && "bg-surface-3",
									)}
									data-testid="composer-menu-row"
									data-ref={`${h.ref.kind}:${h.ref.id}`}
								>
									{/* Page actions keep the id their journeys and docs name; it spans the row's words. */}
									<span
										className="contents"
										data-testid={
											h.ref.kind === "command"
												? `composer-slash-${h.ref.id}`
												: undefined
										}
									>
										<Icon
											className="size-3.5 shrink-0 text-text-3"
											aria-hidden
											data-testid="composer-menu-icon"
											data-kind={h.ref.kind}
										/>
										<span className="shrink-0 truncate">{h.ref.label}</span>
										{h.inputHint && (
											<span className="shrink-0 font-mono text-meta text-text-3">
												{h.inputHint}
											</span>
										)}
										{h.detail && (
											<span className="min-w-0 truncate text-meta text-text-3">
												{h.detail}
											</span>
										)}
									</span>
									{why && (
										<span
											className="ml-auto shrink-0 text-meta text-text-3"
											data-testid="composer-menu-why"
										>
											{why}
										</span>
									)}
								</div>
							);
						})}
						{g.more > 0 && (
							<div
								className="px-2.5 py-1 text-meta text-text-3"
								data-testid="composer-menu-more"
							>
								{g.more} more: type to filter
							</div>
						)}
					</div>
				))}
			</div>
			{unavailable.map((u) => (
				<div
					key={u.source}
					className="truncate px-2.5 py-1 text-meta text-text-3"
					data-testid="composer-menu-unavailable"
				>
					{u.source}: {u.message}
				</div>
			))}
			{loading && !result && (
				<div
					className="flex h-8 items-center gap-2 px-2.5 text-meta text-text-3"
					data-testid="composer-menu-loading"
				>
					<Ring />
					Searching
				</div>
			)}
			{failed && !result && (
				<div
					className="px-2.5 py-1.5 text-meta text-danger"
					data-testid="composer-menu-failed"
				>
					Search failed: {failed}
				</div>
			)}
			{empty &&
				(trigger === "#" && !query && unavailable.length === 0 ? (
					<div
						className="flex items-center gap-2 px-2.5 py-1 text-meta text-text-3"
						data-testid="composer-menu-connect"
					>
						Connect a source
						<Button variant="text" size="sm" asChild>
							<Link to="/settings" search={{ tab: "sources" }}>
								Settings, Sources
							</Link>
						</Button>
					</div>
				) : (
					<div
						className="px-2.5 py-1.5 text-meta text-text-3"
						data-testid="composer-menu-empty"
					>
						{query ? "No matches" : "Nothing recent"}
					</div>
				))}
		</div>
	);
}
