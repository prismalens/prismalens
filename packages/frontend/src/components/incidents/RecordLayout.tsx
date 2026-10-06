// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export const RECORD_ROUTES = {
	conversation: "/incidents/$id/conversation",
	report: "/incidents/$id/report",
	alerts: "/incidents/$id/alerts",
	timeline: "/incidents/$id/timeline",
} as const;
export type RecordRoute = keyof typeof RECORD_ROUTES;

/** The reading column and, from 1280, the facts rail beside it (study-v3 §3.3). */
const GRID =
	"mx-auto grid w-full max-w-[calc(var(--reading-w)+3rem)] grid-cols-1 gap-x-12 px-4 sm:px-6 xl:max-w-[calc(var(--reading-w)+var(--facts-w)+6rem)] xl:grid-cols-[minmax(0,var(--reading-w))_var(--facts-w)] xl:justify-center";

/**
 * One incident tab: a centred reading column, the facts rail at 1280 and up,
 * and the box docked under the column so the two line up.
 */
export function RecordPage({
	children,
	rail,
	box,
	testId,
}: {
	children: ReactNode;
	rail?: ReactNode;
	box?: ReactNode;
	testId?: string;
}) {
	return (
		<div className="flex h-full min-h-0 flex-col">
			<div className="min-h-0 flex-1 overflow-y-auto" data-testid={testId}>
				<div className={cn(GRID, "pt-6 pb-12")}>
					<div className="min-w-0">{children}</div>
					{rail && (
						<aside
							className="hidden xl:block"
							aria-label="Facts"
							data-testid="facts-rail"
						>
							<div className="sticky top-0">{rail}</div>
						</aside>
					)}
				</div>
			</div>
			{box && (
				<div className="shrink-0 pt-1 pb-3">
					<div className={GRID}>
						<div className="min-w-0">{box}</div>
					</div>
				</div>
			)}
		</div>
	);
}

export interface Fact {
	label: string;
	value: ReactNode;
	testId?: string;
}

/** The rail: one fact per row, label over value; actions under the facts. */
export function FactsRail({
	facts,
	actions,
}: {
	facts: Fact[];
	actions?: ReactNode;
}) {
	return (
		<>
			<dl className="grid gap-3.5">
				{facts.map((f) => (
					<div key={f.label} data-testid={f.testId}>
						<dt className="text-meta text-text-3">{f.label}</dt>
						<dd className="mt-0.5 flex flex-col items-start gap-0.5 text-body text-text-2 [overflow-wrap:anywhere]">
							{f.value}
						</dd>
					</div>
				))}
			</dl>
			{actions && (
				<div className="mt-6 grid gap-1.5" data-testid="rail-actions">
					{actions}
				</div>
			)}
		</>
	);
}

/** Below 1280 the rail's facts are one quiet line: separate spans, no separators. */
export function DetailsLine({ parts }: { parts: ReactNode[] }) {
	return (
		<p
			className="mt-10 flex flex-wrap gap-x-3.5 gap-y-1 text-meta text-text-3 xl:hidden"
			data-testid="details-line"
		>
			{parts.map((p, i) => (
				// biome-ignore lint/suspicious/noArrayIndexKey: a fixed list of facts
				<span key={i}>{p}</span>
			))}
		</p>
	);
}

/** A tab of this incident, as a link: section headings and rail rows use it. */
export function RecordLink({
	incidentId,
	to,
	search,
	children,
	className,
	testId,
}: {
	incidentId: string;
	to: RecordRoute;
	search?: Record<string, string>;
	children: ReactNode;
	className?: string;
	testId?: string;
}) {
	return (
		<Link
			to={RECORD_ROUTES[to]}
			params={{ id: incidentId }}
			search={(prev: Record<string, unknown>) => ({ ...prev, ...search })}
			viewTransition
			className={cn("text-accent hover:underline", className)}
			data-testid={testId}
		>
			{children}
		</Link>
	);
}

/** A section of the reading column; a heading that names a tab is the way to it. */
export function TabSection({
	title,
	count,
	to,
	incidentId,
	children,
	className,
	testId,
}: {
	title: string;
	count?: number;
	to?: RecordRoute;
	incidentId?: string;
	children: ReactNode;
	className?: string;
	testId?: string;
}) {
	const heading = (
		<>
			{title}
			{count !== undefined && (
				<span className="font-normal text-text-3 tabular-nums">{count}</span>
			)}
		</>
	);
	return (
		<section className={cn("mt-8 first:mt-0", className)} data-testid={testId}>
			<h3 className="mb-2 flex items-baseline gap-2 text-heading">
				{to && incidentId ? (
					<RecordLink
						incidentId={incidentId}
						to={to}
						className="inline-flex items-baseline gap-2 text-text-1 hover:text-accent hover:no-underline"
						testId={testId ? `${testId}-heading` : undefined}
					>
						{heading}
					</RecordLink>
				) : (
					heading
				)}
			</h3>
			{children}
		</section>
	);
}

/** Rows separated by hairlines, never enclosed. */
export const ROWS =
	"[&>*]:flex [&>*]:min-w-0 [&>*]:items-start [&>*]:gap-3 [&>*]:border-t [&>*]:border-hairline [&>*]:py-2.5 [&>*:first-child]:border-t-0";
