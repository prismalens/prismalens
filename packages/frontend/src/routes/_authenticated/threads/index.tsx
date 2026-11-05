// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { useInfiniteQuery } from "@tanstack/react-query";
import {
	createFileRoute,
	Link,
	useLocation,
	useNavigate,
} from "@tanstack/react-router";
import { PageHeader } from "@/components/shell/PageHeader";
import {
	incidentRow,
	ORIGIN_WORD,
	STATE_WORD,
	type ThreadRow,
	ThreadRowView,
	useThreadRows,
} from "@/components/shell/ThreadList";
import { Button } from "@/components/ui/button";
import { useNow } from "@/hooks/use-now";
import { usePageTitle } from "@/hooks/use-page-title";
import { orpc } from "@/lib/api/orpc-client";
import { threadGroups } from "@/lib/thread-groups";

const ORIGINS = ["all", "you", "alert", "webhook", "schedule"] as const;
const STATES = ["all", "waiting", "working", "failed", "ready"] as const;
type Origin = (typeof ORIGINS)[number];
type StateFilter = (typeof STATES)[number];

export const Route = createFileRoute("/_authenticated/threads/")({
	validateSearch: (
		s: Record<string, unknown>,
	): { origin?: Origin; state?: StateFilter; q?: string } => ({
		origin: ORIGINS.includes(s.origin as Origin)
			? (s.origin as Origin)
			: undefined,
		state: STATES.includes(s.state as StateFilter)
			? (s.state as StateFilter)
			: undefined,
		q: typeof s.q === "string" ? s.q : undefined,
	}),
	component: Threads,
});

const ORIGIN_LABEL: Record<Origin, string> = {
	all: "Started by anyone",
	you: "Started by you",
	alert: ORIGIN_WORD.alert ?? "Alert",
	webhook: ORIGIN_WORD.webhook ?? "Webhook",
	schedule: ORIGIN_WORD.schedule ?? "Scheduled",
};
const STATE_LABEL: Record<StateFilter, string> = {
	all: "Any status",
	waiting: "Waiting for you",
	working: STATE_WORD.working,
	failed: STATE_WORD.failed,
	ready: STATE_WORD.ready,
};

const PAGE = 50;

function matches(r: ThreadRow, origin: Origin, state: StateFilter, q: string) {
	if (origin !== "all" && r.origin !== origin) return false;
	if (state === "waiting" && r.state !== "asks") return false;
	if (state !== "all" && state !== "waiting" && r.state !== state) return false;
	// The raw alert name matches too: people search by what the alert is called.
	const text = `${r.title} ${r.incident?.title ?? ""}`.toLowerCase();
	return !q || text.includes(q.toLowerCase());
}

/** Resolved threads, fifty at a time, so the whole history can be reached (D19). */
function useResolvedThreads() {
	return useInfiniteQuery({
		queryKey: ["threads-page", "closed"],
		initialPageParam: 0,
		queryFn: ({ pageParam }) =>
			orpc.incidents.list.call({
				status: "closed",
				limit: PAGE,
				offset: pageParam,
			}),
		getNextPageParam: (last) =>
			last.pagination.hasMore
				? last.pagination.offset + last.pagination.limit
				: undefined,
	});
}

/**
 * Every thread, newest first by day (D19): filter by who started it and its
 * status, search titles. The sidebar is for switching; this is for finding.
 */
function Threads() {
	usePageTitle("Threads");
	const { origin = "all", state = "all", q = "" } = Route.useSearch();
	const navigate = useNavigate({ from: "/threads/" });
	const { pathname } = useLocation();
	const now = useNow(30_000) ?? 0;
	const open = useThreadRows(0);
	const closed = useResolvedThreads();
	const byKey = new Map(open.rows.map((r) => [r.key, r]));
	for (const i of (closed.data?.pages ?? []).flatMap((p) => p.data)) {
		const r = incidentRow(i, true);
		if (!byKey.has(r.key)) byKey.set(r.key, r);
	}
	const rows = Array.from(byKey.values());
	const shown = rows
		.filter((r) => matches(r, origin, state, q))
		.sort((a, b) => b.at - a.at);
	const filtered = origin !== "all" || state !== "all" || !!q;
	const set = (
		patch: Partial<{ origin: Origin; state: StateFilter; q: string }>,
	) => navigate({ search: (s) => ({ ...s, ...patch }), replace: true });
	const loading = open.isLoading || closed.isLoading;
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
					<input
						type="search"
						value={q}
						onChange={(e) => set({ q: e.target.value || undefined })}
						placeholder="Search thread titles"
						aria-label="Search thread titles"
						className="h-9 w-full rounded-control bg-surface-2 px-3 text-body text-text-1 placeholder:text-text-3"
						data-testid="threads-search"
					/>
					<div className="flex flex-wrap items-center gap-2">
						<Pick
							label="Started by"
							options={ORIGINS}
							labels={ORIGIN_LABEL}
							value={origin}
							onPick={(v) => set({ origin: v === "all" ? undefined : v })}
						/>
						<Pick
							label="Status"
							options={STATES}
							labels={STATE_LABEL}
							value={state}
							onPick={(v) => set({ state: v === "all" ? undefined : v })}
						/>
						{filtered && (
							<button
								type="button"
								onClick={() => navigate({ search: {}, replace: true })}
								className="inline-flex min-h-6 items-center text-body text-accent hover:underline"
								data-testid="threads-clear"
							>
								Clear filters
							</button>
						)}
					</div>
					{loading ? (
						<div className="flex flex-col gap-2 pt-2" aria-busy>
							{[0, 1, 2, 3, 4].map((n) => (
								<div key={n} className="shimmer h-11 rounded-control" />
							))}
						</div>
					) : closed.isError ? (
						<p className="py-6 text-body text-text-2">
							Couldn't load older threads.{" "}
							<button
								type="button"
								onClick={() => void closed.refetch()}
								className="text-accent hover:underline"
							>
								Retry
							</button>
						</p>
					) : rows.length === 0 ? (
						<p className="py-6 text-body text-text-2">
							No threads yet.{" "}
							<Link to="/new" className="text-accent hover:underline">
								Start one
							</Link>
						</p>
					) : shown.length === 0 ? (
						<p
							className="py-6 text-body text-text-2"
							data-testid="threads-none"
						>
							No threads match.{" "}
							<button
								type="button"
								onClick={() => navigate({ search: {}, replace: true })}
								className="text-accent hover:underline"
							>
								Clear filters
							</button>
						</p>
					) : (
						threadGroups(shown, now).map((g) => (
							<section key={g.label} aria-label={g.label}>
								<h2 className="px-2.5 pt-3 pb-1 text-meta font-medium text-text-3">
									{g.label}
								</h2>
								<div className="flex flex-col gap-px">
									{g.rows.map((r) => (
										<ThreadRowView
											key={r.key}
											row={r}
											now={now}
											pathname={pathname}
											detailed
										/>
									))}
								</div>
							</section>
						))
					)}
					{closed.hasNextPage && !loading && (
						<Button
							variant="secondary"
							className="self-center"
							disabled={closed.isFetchingNextPage}
							onClick={() => void closed.fetchNextPage()}
							data-testid="threads-more"
						>
							{closed.isFetchingNextPage ? "Loading" : "Load older threads"}
						</Button>
					)}
				</div>
			</div>
		</div>
	);
}

function Pick<T extends string>({
	label,
	options,
	labels,
	value,
	onPick,
}: {
	label: string;
	options: readonly T[];
	labels: Record<T, string>;
	value: T;
	onPick: (v: T) => void;
}) {
	return (
		<select
			aria-label={label}
			value={value}
			onChange={(e) => onPick(e.target.value as T)}
			className="h-8 min-w-0 rounded-control bg-surface-2 px-2 text-body text-text-1 max-sm:flex-1"
			data-testid={`threads-filter-${label.toLowerCase().replace(/\s+/g, "-")}`}
		>
			{options.map((o) => (
				<option key={o} value={o}>
					{labels[o]}
				</option>
			))}
		</select>
	);
}
