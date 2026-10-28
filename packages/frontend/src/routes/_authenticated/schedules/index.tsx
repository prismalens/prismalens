// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { BuiltInJob, Schedule } from "@prismalens/contracts";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Lock, Plus } from "lucide-react";
import { useState } from "react";
import { HostOnlyNote } from "@/components/schedules/HostOnlyNote";
import { ScheduleDialog } from "@/components/schedules/ScheduleDialog";
import { clock, whenText } from "@/components/schedules/schedule-time";
import { TickDot } from "@/components/schedules/TickDot";
import { tickLine } from "@/components/schedules/tick-copy";
import { Empty, Loading, Problem } from "@/components/shared/State";
import { PageHeader } from "@/components/shell/PageHeader";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { usePageTitle } from "@/hooks/use-page-title";
import { useSchedules, useSetScheduleEnabled } from "@/lib/api/hooks";
import { getErrorMessage } from "@/lib/get-error-message";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/schedules/")({
	component: SchedulesPage,
});

const ROW =
	"grid min-h-14 grid-cols-[minmax(0,1fr)_44px] items-center gap-x-3 gap-y-0.5 px-3.5 py-3 @3xl:grid-cols-[minmax(0,1.5fr)_minmax(0,1.1fr)_minmax(0,1fr)_minmax(0,1.3fr)_44px]";
const CELL = "col-start-1 min-w-0 truncate text-meta @3xl:col-start-auto";

/** Every device sees the same schedules; only the host changes them (#979). */
function SchedulesPage() {
	usePageTitle("Schedules");
	const { data, isLoading, error, refetch } = useSchedules();
	const [creating, setCreating] = useState(false);
	const canEdit = data?.canEdit ?? false;
	return (
		<div className="flex h-full min-h-0 flex-col">
			<PageHeader
				title="Schedules"
				primary={
					canEdit ? (
						<Button
							onClick={() => setCreating(true)}
							data-testid="new-schedule"
						>
							<Plus />
							<span className="max-sm:sr-only">New schedule</span>
						</Button>
					) : data ? (
						<span
							className="inline-flex items-center gap-1.5 text-meta text-text-3"
							title={`Schedules are changed on ${data.hostName}`}
						>
							<Lock className="size-3.5" />
							<span className="max-sm:sr-only">View only</span>
						</span>
					) : null
				}
			/>
			<div className="min-h-0 flex-1 overflow-y-auto px-4 pb-6 @container">
				<div className="mx-auto grid max-w-(--reading-w) gap-5 pt-1">
					{data && !canEdit && <HostOnlyNote hostName={data.hostName} />}
					{isLoading ? (
						<Loading />
					) : error ? (
						<Problem
							text={getErrorMessage(error)}
							onRetry={() => void refetch()}
						/>
					) : data && data.schedules.length === 0 ? (
						<Empty
							text={
								canEdit
									? "No schedules yet. A schedule checks a service on its own, at the times you pick."
									: "No schedules yet."
							}
							action={
								canEdit ? (
									<Button variant="secondary" onClick={() => setCreating(true)}>
										New schedule
									</Button>
								) : undefined
							}
						/>
					) : (
						data && (
							<div
								className="overflow-hidden rounded-pool bg-surface-2"
								data-testid="schedule-list"
							>
								<div
									className={cn(
										ROW,
										"hidden min-h-0 py-2 text-meta text-text-3 @3xl:grid",
									)}
								>
									<span>Schedule</span>
									<span>When</span>
									<span>Next run</span>
									<span>Last run</span>
									<span />
								</div>
								{data.schedules.map((s) => (
									<ScheduleRow key={s.id} schedule={s} canEdit={canEdit} />
								))}
							</div>
						)
					)}
					{data && data.builtIns.length > 0 && (
						<section>
							<h2 className="mb-1.5 ml-1 text-heading text-text-2">
								Built into PrismaLens
							</h2>
							<div className="overflow-hidden rounded-pool bg-surface-2">
								{data.builtIns.map((b) => (
									<BuiltInRow key={b.id} job={b} />
								))}
							</div>
						</section>
					)}
				</div>
			</div>
			{canEdit && (
				<ScheduleDialog
					open={creating}
					onOpenChange={setCreating}
					canSetHostZone
				/>
			)}
		</div>
	);
}

function ScheduleRow({
	schedule: s,
	canEdit,
}: {
	schedule: Schedule;
	canEdit: boolean;
}) {
	const toggle = useSetScheduleEnabled();
	const last = s.lastTick ? tickLine(s.lastTick, clock) : null;
	return (
		<div
			className={cn(
				ROW,
				"relative border-t border-hairline first:border-t-0 hover:bg-surface-3",
			)}
			data-testid="schedule-row"
		>
			<Link
				to="/schedules/$id"
				params={{ id: s.id }}
				className="min-w-0 after:absolute after:inset-0 focus-visible:outline-none focus-visible:after:outline-2 focus-visible:after:outline-accent"
			>
				<div
					className={cn("truncate text-heading", !s.enabled && "text-text-2")}
				>
					{s.name}
				</div>
				<div className="truncate text-meta text-text-3">
					Check {s.serviceName}
				</div>
			</Link>
			<span className={cn(CELL, "text-text-2")}>{s.description}</span>
			<span className={cn(CELL, "text-text-3")}>
				{s.enabled
					? `Next ${whenText(s.nextRunAt)}`
					: (s.pausedReason ?? "Paused")}
			</span>
			<span className={cn(CELL, "flex items-center gap-2 text-body")}>
				{last ? (
					<>
						<TickDot tone={last.tone} />
						<span
							className={cn("truncate", last.tone === "bad" && "text-danger")}
						>
							{last.text}
						</span>
					</>
				) : (
					<span className="text-text-3">No runs yet</span>
				)}
			</span>
			<span className="relative z-10 col-start-2 row-span-4 row-start-1 flex size-11 items-center justify-center @3xl:col-start-auto @3xl:row-span-1 @3xl:row-start-auto">
				{canEdit && (
					<Switch
						checked={s.enabled}
						aria-label={`${s.name} active`}
						disabled={toggle.isPending}
						onCheckedChange={(enabled) => toggle.mutate({ id: s.id, enabled })}
					/>
				)}
			</span>
		</div>
	);
}

function BuiltInRow({ job }: { job: BuiltInJob }) {
	return (
		<div className={cn(ROW, "border-t border-hairline first:border-t-0")}>
			<div className="min-w-0">
				<div className="truncate text-heading">{job.name}</div>
				<div className="truncate text-meta text-text-3">{job.description}</div>
			</div>
			<span className={cn(CELL, "text-text-2")}>{job.cadence}</span>
			<span className={cn(CELL, "text-text-3")}>
				{job.nextRunAt ? `Next ${whenText(job.nextRunAt)}` : "Next start"}
			</span>
			<span className={cn(CELL, "text-body text-text-2")}>
				{job.lastResult ??
					(job.lastRunAt ? `Last ran ${whenText(job.lastRunAt)}` : "")}
			</span>
			<span />
		</div>
	);
}
