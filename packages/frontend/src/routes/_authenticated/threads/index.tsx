// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { X } from "lucide-react";
import { useMemo, useState } from "react";
import { PageHeader } from "@/components/shell/PageHeader";
import {
	useAsksByThread,
	useThreadListModel,
} from "@/components/shell/ThreadList";
import { ThreadTreeView } from "@/components/shell/ThreadTree";
import { Button } from "@/components/ui/button";
import { useNow } from "@/hooks/use-now";
import { usePageTitle } from "@/hooks/use-page-title";
import { useSettleUndo } from "@/hooks/use-settle-undo";
import { useSettleThread } from "@/lib/api/hooks/use-threads-orpc";
import {
	formatFilter,
	isEmptyFilter,
	nodeMatches,
	parseFilter,
	withoutTerm,
} from "@/lib/thread-filter";

export const Route = createFileRoute("/_authenticated/threads/")({
	validateSearch: (
		s: Record<string, unknown>,
	): { f?: string; archived?: boolean } => ({
		f: typeof s.f === "string" && s.f.trim() ? s.f : undefined,
		archived: s.archived === true || s.archived === "true" ? true : undefined,
	}),
	component: Threads,
});

const EXAMPLES = ["state:needs", "state:waiting", "pr:failing", "is:pinned"];

/**
 * Every thread as the sidebar draws it, with a typed filter kept in the URL (#1101
 * category 1 item 7): `state:waiting parent:checkout pr:failing` and title words.
 */
function Threads() {
	usePageTitle("Threads");
	const { f = "", archived } = Route.useSearch();
	const navigate = useNavigate({ from: "/threads/" });
	const [draft, setDraft] = useState(f);
	const filter = useMemo(() => parseFilter(f), [f]);
	const now = useNow(30_000) ?? 0;
	const { model, feed, isLoading } = useThreadListModel({
		...(filter.text ? { search: filter.text } : {}),
		...(archived ? { archived: true } : {}),
		limit: 100,
	});
	const asks = useAsksByThread();
	const settle = useSettleThread();
	const { settle: onSettle } = useSettleUndo(settle.mutate);
	const apply = (next: string, opts: { archived?: boolean } = {}) => {
		setDraft(next);
		void navigate({
			search: {
				...(next.trim() ? { f: next.trim() } : {}),
				...((opts.archived ?? archived) ? { archived: true } : {}),
			},
			replace: true,
		});
	};
	return (
		<div className="flex h-full min-h-0 flex-col" data-testid="threads-page">
			<PageHeader title="Threads">
				<Button asChild size="sm" className="ml-auto">
					<Link to="/new" data-testid="threads-new">
						New thread
					</Link>
				</Button>
			</PageHeader>
			<div className="min-h-0 flex-1 overflow-y-auto pb-10">
				<div className="mx-auto flex w-full max-w-[900px] flex-col gap-3 px-4 pt-4">
					<form
						onSubmit={(e) => {
							e.preventDefault();
							apply(draft);
						}}
					>
						<input
							type="search"
							value={draft}
							onChange={(e) => setDraft(e.target.value)}
							onBlur={() => draft !== f && apply(draft)}
							placeholder="Filter: state:waiting parent:checkout pr:failing"
							aria-label="Filter threads"
							className="h-9 w-full rounded-control bg-surface-2 px-3 font-mono text-body text-text-1 placeholder:font-sans placeholder:text-text-3"
							data-testid="threads-search"
						/>
					</form>
					<div
						className="flex flex-wrap items-center gap-1.5"
						data-testid="threads-chips"
					>
						{filter.terms.map((t, i) => (
							<span
								key={`${t.key}:${t.value}`}
								className="inline-flex h-6 items-center gap-1 rounded-control bg-surface-3 pr-0.5 pl-2 font-mono text-meta text-text-1"
								data-testid="threads-chip"
							>
								{t.key}:{t.value}
								<button
									type="button"
									aria-label={`Remove ${t.key}:${t.value}`}
									onClick={() => apply(formatFilter(withoutTerm(filter, i)))}
									className="flex size-5 items-center justify-center rounded-control text-text-3 hover:bg-surface-4 hover:text-text-1"
								>
									<X className="size-3" aria-hidden />
								</button>
							</span>
						))}
						{isEmptyFilter(filter) &&
							EXAMPLES.map((ex) => (
								<button
									key={ex}
									type="button"
									onClick={() => apply(ex)}
									className="inline-flex h-6 items-center rounded-control px-2 font-mono text-meta text-text-3 hover:bg-surface-2 hover:text-text-1"
								>
									{ex}
								</button>
							))}
						<button
							type="button"
							aria-pressed={!!archived}
							onClick={() => apply(draft, { archived: !archived })}
							className="ml-auto inline-flex h-6 items-center rounded-control px-2 text-meta text-text-2 hover:bg-surface-2 aria-pressed:bg-surface-3 aria-pressed:text-text-1"
							data-testid="threads-archived"
						>
							Archived
						</button>
					</div>
					{isLoading ? (
						<div className="flex flex-col gap-2 pt-2" aria-busy>
							{[0, 1, 2, 3, 4].map((n) => (
								<div key={n} className="shimmer h-11 rounded-control" />
							))}
						</div>
					) : feed.isError ? (
						<p className="py-6 text-body text-text-2">
							Couldn't load threads.{" "}
							<button
								type="button"
								onClick={() => void feed.refetch()}
								className="text-accent hover:underline"
							>
								Retry
							</button>
						</p>
					) : (
						<ThreadTreeView
							model={model}
							asks={asks}
							now={now}
							currentId={null}
							onSettle={onSettle}
							onMoreSettled={() => {
								if (feed.hasNextPage) void feed.fetchNextPage();
							}}
							{...(isEmptyFilter(filter) || !filter.terms.length
								? {}
								: { filter: (n) => nodeMatches({ ...filter, text: "" }, n) })}
						/>
					)}
				</div>
			</div>
		</div>
	);
}
