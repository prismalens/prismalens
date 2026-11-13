// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { BuiltInJob, Schedule } from "@prismalens/contracts";
import { Link, useNavigate } from "@tanstack/react-router";
import { Lock, Plus } from "lucide-react";
import { useState } from "react";
import { ListCard, ListGrid } from "@/components/kit";
import { surfaceEntries } from "@/components/kit/registry";
import { HostOnlyNote } from "@/components/schedules/HostOnlyNote";
import { ScheduleDialog } from "@/components/schedules/ScheduleDialog";
import { ScheduleTemplates } from "@/components/schedules/schedule-templates";
import { clock, whenText } from "@/components/schedules/schedule-time";
import { aboutText, tickLine } from "@/components/schedules/tick-copy";
import { Empty, Loading, Problem } from "@/components/shared/State";
import { HelperThread } from "@/components/thread/HelperThread";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import {
	useRunScheduleNow,
	useSchedules,
	useSetScheduleEnabled,
} from "@/lib/api/hooks/use-schedules-orpc";
import { getErrorMessage } from "@/lib/get-error-message";
import { cadenceText } from "./schedule-form";

/** Automation, Schedules: New schedule for the host, View only elsewhere (#979, #1020). */
export function NewScheduleAction() {
	const { data } = useSchedules();
	const [creating, setCreating] = useState(false);
	if (!data) return null;
	if (!data.canEdit)
		return (
			<span className="inline-flex items-center gap-1.5 text-meta text-text-3">
				<Lock className="size-3.5" />
				<span className="max-sm:sr-only">View only</span>
			</span>
		);
	return (
		<>
			<Button onClick={() => setCreating(true)} data-testid="new-schedule">
				<Plus />
				<span className="max-sm:sr-only">New schedule</span>
			</Button>
			<ScheduleDialog
				open={creating}
				onOpenChange={setCreating}
				canSetHostZone
			/>
		</>
	);
}

/** Every device sees the same schedules; only the host changes them (#979). */
export function SchedulesSection() {
	const { data, isLoading, error, refetch } = useSchedules();
	const canEdit = data?.canEdit ?? false;
	return (
		<div className="@container mx-auto grid w-full grid-cols-[minmax(0,1fr)] gap-5 pt-1">
			{data && !canEdit && <HostOnlyNote hostName={data.hostName} />}
			{isLoading ? (
				<Loading />
			) : error ? (
				<Problem text={getErrorMessage(error)} onRetry={() => void refetch()} />
			) : data && data.schedules.length === 0 ? (
				<>
					<Empty testId="schedules-empty" text={"No schedules yet"} />
					<ScheduleTemplates />
					{/* The host starts from a template; the ask-how box is for those who can't. */}
					{!canEdit && <HelperThread place="schedules" />}
				</>
			) : (
				data && (
					<ListGrid label="Schedules" testId="schedule-list">
						{data.schedules.map((s) => (
							<ScheduleRow key={s.id} schedule={s} canEdit={canEdit} />
						))}
					</ListGrid>
				)
			)}
			{data && data.schedules.length > 0 && <ScheduleTemplates />}
			{data && data.builtIns.length > 0 && (
				<section className="flex flex-col gap-1.5">
					<h2 className="ml-1 text-heading text-text-2">Built in</h2>
					<ListGrid label="Built in">
						{data.builtIns.map((b) => (
							<BuiltInRow key={b.id} job={b} />
						))}
					</ListGrid>
				</section>
			)}
		</div>
	);
}

/** A schedule as a list card: name, its last run's status in words, when it runs next. */
export function ScheduleRow({
	schedule: s,
	canEdit,
}: {
	schedule: Schedule;
	canEdit: boolean;
}) {
	const toggle = useSetScheduleEnabled();
	const runNow = useRunScheduleNow();
	const navigate = useNavigate();
	const { toast } = useToast();
	const last = s.lastTick ? tickLine(s.lastTick, clock) : null;
	const unread = s.unreadRuns ?? 0;
	const setEnabled = (enabled: boolean) =>
		toggle.mutate(
			{ id: s.id, enabled },
			{
				onError: (error) =>
					toast({
						title: "Schedule not updated",
						description: getErrorMessage(error),
						variant: "destructive",
					}),
			},
		);
	// Cadence first, so a card says how often before when next (#1101 bar 22.1).
	const cadence = cadenceText(s.recurrence) ?? "Custom";
	const when = s.enabled
		? `Next ${whenText(s.nextRunAt)}`
		: (s.pausedReason ?? "Paused");
	return (
		<ListCard
			title={s.name}
			status={!s.enabled ? "idle" : (last?.status ?? "idle")}
			statusWord={!s.enabled ? "Paused" : (last?.text ?? "No runs yet")}
			detail={[
				cadence,
				when,
				unread > 0 ? `${unread} unread` : null,
				aboutText(s),
			]
				.filter(Boolean)
				.join(" · ")}
			link={(title) => (
				<Link to="/schedules/$id" params={{ id: s.id }}>
					{title}
				</Link>
			)}
			menu={surfaceEntries("schedule.row", "more", {
				href: `${window.location.origin}/schedules/${s.id}`,
				open: () =>
					void navigate({ to: "/schedules/$id", params: { id: s.id } }),
				runNow: () =>
					runNow.mutate(
						{ id: s.id },
						{
							onSuccess: () => toast({ title: "Run started" }),
							onError: (error) =>
								toast({
									title: "Run not started",
									description: getErrorMessage(error),
									variant: "destructive",
								}),
						},
					),
				setEnabled,
				facts: {
					is: {
						enabled: s.enabled,
						editable: !!canEdit,
						busy: toggle.isPending || runNow.isPending,
					},
				},
			})}
			testId="schedule-row"
		/>
	);
}

function BuiltInRow({ job }: { job: BuiltInJob }) {
	return (
		<ListCard
			title={job.name}
			meta={[
				job.cadence,
				job.lastResult ??
					(job.lastRunAt
						? `Last ran ${whenText(job.lastRunAt)}`
						: job.nextRunAt
							? `Next ${whenText(job.nextRunAt)}`
							: "Next start"),
			].join(" · ")}
		/>
	);
}
