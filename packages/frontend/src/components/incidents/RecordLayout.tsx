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
export const RECORD_GRID =
	"mx-auto grid w-full max-w-[calc(var(--reading-w)+3rem)] grid-cols-1 gap-x-10 px-4 sm:px-6 xl:max-w-[calc(var(--reading-w)+var(--facts-w)+6rem)] xl:grid-cols-[minmax(0,var(--reading-w))_var(--facts-w)] xl:justify-center";

/**
 * One incident tab: a centred reading column, the facts rail at 1280 and up,
 * and the box docked under the column so the two line up. The column fades
 * out under the box rather than ending at a hard edge (look ruling L44).
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
				<div className={cn(RECORD_GRID, "pt-6 pb-12")}>
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
			{box && <BoxDock>{box}</BoxDock>}
		</div>
	);
}

/** The box under the column, on a fade that lets the content scroll out beneath it. */
export function BoxDock({ children }: { children: ReactNode }) {
	return (
		<div className="pointer-events-none relative -mt-8 shrink-0 bg-[linear-gradient(to_top,var(--canvas)_70%,transparent)] pt-8 pb-3 max-sm:pb-2">
			<div className={RECORD_GRID}>
				<div className="pointer-events-auto min-w-0">{children}</div>
			</div>
		</div>
	);
}

export interface Fact {
	label: string;
	value: ReactNode;
	testId?: string;
}

/** The rail: an s1 pool, one fact per row, label over value; actions under the facts. */
export function FactsRail({
	facts,
	actions,
}: {
	facts: Fact[];
	actions?: ReactNode;
}) {
	return (
		<div className="pool px-3.5 py-3" data-testid="facts-pool">
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
				<div className="mt-5 grid gap-1.5" data-testid="rail-actions">
					{actions}
				</div>
			)}
		</div>
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

/** Rows with a hairline between them, never enclosed (look ruling §1.1). */
export const ROWS =
	"divide-y divide-hairline [&>*]:flex [&>*]:min-w-0 [&>*]:items-start [&>*]:gap-3 [&>*]:py-2.5";
