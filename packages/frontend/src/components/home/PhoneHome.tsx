// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { Link } from "@tanstack/react-router";
import { SquarePen } from "lucide-react";
import { useMemo } from "react";
import { Blank, Loading } from "@/components/shared/State";
import { PageHeader } from "@/components/shell/PageHeader";
import { useAsksByThread, useThreadRows } from "@/components/shell/ThreadList";
import { StatusMark } from "@/components/shell/ThreadTree";
import { useNow } from "@/hooks/use-now";
import { usePageTitle } from "@/hooks/use-page-title";
import { type HomeItem, homeItems } from "@/lib/phone-home";
import { ageWord, STATUS_TONE, TONE_TEXT } from "@/lib/thread-status";
import { cn } from "@/lib/utils";

/** The phone's landing page: what needs you, then everything else by status. */
export function PhoneHome() {
	usePageTitle("Home");
	const { units, isLoading } = useThreadRows();
	const asks = useAsksByThread();
	const now = useNow(30_000);
	const list = useMemo(
		() => homeItems(units, asks, now ?? 0),
		[units, asks, now],
	);
	return (
		<PhoneHomeView
			loading={isLoading}
			needs={list.needs}
			rest={list.rest}
			more={list.more}
			now={now}
		/>
	);
}

export function PhoneHomeView({
	loading,
	needs,
	rest,
	more,
	now,
}: {
	loading: boolean;
	needs: HomeItem[];
	rest: HomeItem[];
	more: number;
	now: number | null;
}) {
	return (
		<div
			className="flex h-full min-h-0 flex-col overflow-y-auto"
			data-testid="phone-home"
		>
			<PageHeader title="Home" />
			{loading ? (
				<Loading />
			) : needs.length + rest.length === 0 ? (
				<Blank title="No threads yet">
					<Link
						to="/new"
						className="inline-flex min-h-11 items-center gap-2 rounded-control px-3 text-body text-text-1 hover:bg-surface-2"
					>
						<SquarePen className="size-4" aria-hidden />
						New thread
					</Link>
				</Blank>
			) : (
				<div className="flex flex-col gap-4 px-2 pb-6">
					<section aria-label="Needs you">
						<h2 className="flex items-baseline gap-2 px-2 py-2 text-meta font-medium text-text-2">
							Needs you
							<span className="text-warn tabular-nums">{needs.length}</span>
						</h2>
						{needs.length === 0 ? (
							<p
								className="px-2 text-meta text-text-3"
								data-testid="phone-home-clear"
							>
								Nothing needs you
							</p>
						) : (
							<HomeRows items={needs} now={now} />
						)}
					</section>
					{rest.length > 0 && (
						<section aria-label="Other threads">
							<h2 className="px-2 py-2 text-meta font-medium text-text-2">
								Other threads
							</h2>
							<HomeRows items={rest} now={now} />
						</section>
					)}
					<Link
						to="/threads"
						className="flex min-h-11 items-center px-2 text-meta text-text-2 hover:text-text-1"
						data-testid="phone-home-all"
					>
						{more > 0 ? `All threads, ${more} more` : "All threads"}
					</Link>
				</div>
			)}
		</div>
	);
}

function HomeRows({ items, now }: { items: HomeItem[]; now: number | null }) {
	return (
		<ul className="flex flex-col">
			{items.map((i) => (
				<li key={i.id}>
					<Link
						{...i.link}
						className="flex min-h-11 items-start gap-2.5 rounded-control px-2 py-2.5 hover:bg-surface-2 focus-visible:bg-surface-3"
						data-testid="phone-home-row"
						data-status={i.status}
					>
						<StatusMark status={i.status} className="mt-1" />
						<span className="flex min-w-0 flex-1 flex-col gap-0.5">
							<span className="flex items-baseline gap-2">
								<span className="min-w-0 flex-1 truncate text-body text-text-1">
									{i.title}
								</span>
								{now !== null && (
									<span className="shrink-0 text-meta text-text-3 tabular-nums">
										{ageWord(i.at, now)}
									</span>
								)}
							</span>
							<span className="flex min-w-0 items-baseline gap-1.5 text-meta">
								<span
									className={cn(
										"shrink-0 font-medium",
										TONE_TEXT[STATUS_TONE[i.status]],
									)}
								>
									{i.word}
								</span>
								{i.line && (
									<span className="min-w-0 truncate text-text-2">{i.line}</span>
								)}
							</span>
							{i.context && (
								<span className="truncate text-meta text-text-3">
									{i.context}
								</span>
							)}
						</span>
					</Link>
				</li>
			))}
		</ul>
	);
}
