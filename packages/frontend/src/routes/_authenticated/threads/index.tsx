// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import {
	createFileRoute,
	Link,
	useLocation,
	useNavigate,
} from "@tanstack/react-router";
import { PageHeader } from "@/components/shell/PageHeader";
import {
	isOn,
	ORIGIN_WORD,
	STATE_WORD,
	type ThreadRow,
	ThreadRowView,
	useThreadRows,
} from "@/components/shell/ThreadList";
import { Button } from "@/components/ui/button";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { useNow } from "@/hooks/use-now";
import { usePageTitle } from "@/hooks/use-page-title";
import { useRepositories } from "@/lib/api/hooks";
import { threadGroups } from "@/lib/thread-groups";

const ORIGINS = ["all", "you", "alert", "webhook", "schedule"] as const;
const STATES = ["all", "waiting", "working", "failed", "ready"] as const;
type Origin = (typeof ORIGINS)[number];
type StateFilter = (typeof STATES)[number];

export const Route = createFileRoute("/_authenticated/threads/")({
	validateSearch: (
		s: Record<string, unknown>,
	): {
		origin?: Origin;
		state?: StateFilter;
		q?: string;
		project?: string;
	} => ({
		origin: ORIGINS.includes(s.origin as Origin)
			? (s.origin as Origin)
			: undefined,
		state: STATES.includes(s.state as StateFilter)
			? (s.state as StateFilter)
			: undefined,
		q: typeof s.q === "string" ? s.q : undefined,
		project:
			typeof s.project === "string" && /^[0-9a-f-]{36}$/i.test(s.project)
				? s.project
				: undefined,
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

function matches(r: ThreadRow, origin: Origin, state: StateFilter, q: string) {
	if (origin !== "all" && r.origin !== origin) return false;
	if (state === "waiting" && r.state !== "asks") return false;
	if (state !== "all" && state !== "waiting" && r.state !== state) return false;
	// The raw alert name matches too: people search by what the alert is called.
	const text = `${r.title} ${r.thread.title ?? ""}`.toLowerCase();
	return !q || text.includes(q.toLowerCase());
}

/**
 * Every thread, newest first by day (#1020): filter by who started it and its
 * status, search titles. The sidebar is for switching; this is for finding.
 */
function Threads() {
	usePageTitle("Threads");
	const { origin = "all", state = "all", q = "", project } = Route.useSearch();
	const navigate = useNavigate({ from: "/threads/" });
	const { pathname, search } = useLocation();
	const investigation = (search as { investigation?: string }).investigation;
	const repos = useRepositories({ limit: 100 }).data?.data ?? [];
	const now = useNow(30_000) ?? 0;
	const { rows, feed, isLoading } = useThreadRows({
		...(q.trim() ? { search: q.trim() } : {}),
		...(project ? { repositoryId: project } : {}),
	});
	const shown = rows
		.filter((r) => matches(r, origin, state, q))
		.sort((a, b) => b.at - a.at);
	const filtered = origin !== "all" || state !== "all" || !!q || !!project;
	const set = (
		patch: Partial<{
			origin: Origin;
			state: StateFilter;
			q: string;
			project: string;
		}>,
	) => navigate({ search: (s) => ({ ...s, ...patch }), replace: true });
	const loading = isLoading;
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
						{repos.length > 0 && (
							<Select
								value={project ?? "all"}
								onValueChange={(v) =>
									set({ project: v === "all" ? undefined : v })
								}
							>
								<SelectTrigger
									className="h-8 w-auto min-w-36 max-sm:flex-1"
									aria-label="Project"
									data-testid="threads-filter-project"
								>
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									<SelectItem value="all">Any project</SelectItem>
									{repos.map((r) => (
										<SelectItem key={r.id} value={r.id}>
											{r.fullName}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
						)}
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
					) : feed.isError && rows.length === 0 ? (
						<p className="py-6 text-body text-text-2">
							Couldn't load older threads.{" "}
							<button
								type="button"
								onClick={() => void feed.refetch()}
								className="text-accent hover:underline"
							>
								Retry
							</button>
						</p>
					) : rows.length === 0 && !filtered ? (
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
											on={isOn(r, pathname, investigation)}
											detailed
										/>
									))}
								</div>
							</section>
						))
					)}
					{feed.hasNextPage && !loading && (
						<Button
							variant="secondary"
							className="self-center"
							disabled={feed.isFetchingNextPage}
							onClick={() => void feed.fetchNextPage()}
							data-testid="threads-more"
						>
							{feed.isFetchingNextPage ? "Loading" : "Load older threads"}
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
		<Select value={value} onValueChange={(v) => onPick(v as T)}>
			<SelectTrigger
				className="h-8 w-auto min-w-36 max-sm:flex-1"
				aria-label={label}
				data-testid={`threads-filter-${label.toLowerCase().replace(/\s+/g, "-")}`}
			>
				<SelectValue />
			</SelectTrigger>
			<SelectContent>
				{options.map((o) => (
					<SelectItem key={o} value={o}>
						{labels[o]}
					</SelectItem>
				))}
			</SelectContent>
		</Select>
	);
}
