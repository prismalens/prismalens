// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { RunState } from "@prismalens/contracts";
import { useQuery } from "@tanstack/react-query";
import { Link, useRouterState, useSearch } from "@tanstack/react-router";
import { MessageSquare, Plus, Search } from "lucide-react";
import { useNow } from "@/hooks/use-now";
import { useLiveRefreshInterval } from "@/lib/api/live-refresh";
import { orpc } from "@/lib/api/orpc-client";
import { cn } from "@/lib/utils";
import { DRAFT } from "./record-context";
import { elapsedWord, openRun, refState, runDot, runName } from "./run-facts";

export function RunDot({
	state,
	draft,
	className,
}: {
	state?: RunState;
	draft?: boolean;
	className?: string;
}) {
	const tone = state ? runDot(state) : null;
	return (
		<span
			aria-hidden
			className={cn(
				"size-1.5 shrink-0 rounded-full",
				draft &&
					"outline-[1.5px] -outline-offset-[1.5px] outline-text-3 outline-solid",
				tone === "live" && "breathe bg-live",
				tone === "ok" && "bg-ok",
				tone === "danger" && "bg-danger",
				tone === "quiet" && "bg-text-3",
				className,
			)}
			data-dot={draft ? "draft" : (tone ?? undefined)}
		/>
	);
}

/** A thread's kind (#673 w59): a search for an investigation, a bubble for a chat. */
export function KindIcon({ kind }: { kind?: string | null }) {
	const Icon = kind === "chat" ? MessageSquare : Search;
	return (
		<Icon
			className="size-3 shrink-0 text-text-3"
			aria-label={kind === "chat" ? "Chat" : "Investigation"}
			data-kind={kind === "chat" ? "chat" : "investigation"}
		/>
	);
}

const ROW =
	"relative flex h-[26px] min-w-0 items-center gap-2 rounded-control pr-2 pl-[30px] text-meta text-text-2 transition-colors duration-(--dur-instant) hover:bg-surface-2 hover:text-text-1";

/**
 * The open incident's runs as its children in the sidebar (#673): newest
 * first, a state dot, the title or `Run #N`, elapsed or `Working`; then `New run`.
 */
export function RunTree({ incidentId }: { incidentId: string }) {
	const { data } = useQuery({
		...orpc.incidents.get.queryOptions({ input: { id: incidentId } }),
		refetchInterval: useLiveRefreshInterval(),
	});
	const search = useSearch({ strict: false }) as { investigation?: string };
	const now = useNow(1000);
	const runs = data?.investigations ?? [];
	const draft = search.investigation === DRAFT;
	const onReport = useRouterState({
		select: (st) => st.location.pathname.endsWith("/report"),
	});
	const selected =
		search.investigation ?? (draft ? null : openRun(runs, onReport)?.id);
	const dot = "absolute top-[10px] left-4";
	return (
		<div className="grid gap-px pt-0.5 pb-1" data-testid="run-tree">
			{draft && (
				<span
					className={cn(ROW, "bg-surface-3 text-text-1")}
					data-testid="run-tree-draft"
				>
					<RunDot draft className={dot} />
					<span className="min-w-0 flex-1 truncate">Draft</span>
					<span className="shrink-0 text-text-2">Not sent</span>
				</span>
			)}
			{runs.map((r) => {
				const on = !draft && r.id === selected;
				return (
					<Link
						key={r.id}
						to="/incidents/$id/conversation"
						params={{ id: incidentId }}
						search={{ investigation: r.id }}
						aria-current={on ? "true" : undefined}
						className={cn(
							ROW,
							on && "bg-surface-3 text-text-1 hover:bg-surface-3",
						)}
						data-testid="run-tree-row"
						data-run={r.id}
						title={r.kind === "chat" ? undefined : (r.title ?? undefined)}
					>
						<RunDot state={refState(r)} className={dot} />
						<KindIcon kind={r.kind} />
						<span className="min-w-0 flex-1 truncate">{runName(runs, r)}</span>
						<span className="shrink-0 text-text-3 tabular-nums">
							{elapsedWord(r, now)}
						</span>
					</Link>
				);
			})}
			<Link
				to="/incidents/$id/conversation"
				params={{ id: incidentId }}
				search={{ investigation: DRAFT }}
				className={cn(ROW, "text-text-3")}
				data-testid="run-tree-new"
			>
				<Plus className="-ml-0.5 size-3" aria-hidden />
				<span>New run</span>
			</Link>
		</div>
	);
}
