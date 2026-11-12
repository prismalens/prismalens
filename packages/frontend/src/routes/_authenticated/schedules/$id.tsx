// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import {
	ACCESS_LEVEL_LABEL,
	AUTO_START_ACCESS_LEVEL,
	type Schedule,
	type ScheduleTick,
	type ThreadStatusInfo,
} from "@prismalens/contracts";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import {
	ChevronLeft,
	Copy,
	Lock,
	Moon,
	MoreHorizontal,
	Pencil,
	Play,
	Trash2,
	TriangleAlert,
} from "lucide-react";
import { useState } from "react";
import { Status } from "@/components/kit";
import { HostOnlyNote } from "@/components/schedules/HostOnlyNote";
import { ScheduleDialog } from "@/components/schedules/ScheduleDialog";
import {
	clock,
	durationText,
	whenText,
} from "@/components/schedules/schedule-time";
import {
	aboutText,
	latestNote,
	tickLine,
} from "@/components/schedules/tick-copy";
import { useOlderTicks } from "@/components/schedules/use-older-ticks";
import { DestructiveConfirm } from "@/components/shared/DestructiveConfirm";
import { Loading, NotFound, Problem } from "@/components/shared/State";
import { Button } from "@/components/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { usePageTitle } from "@/hooks/use-page-title";
import { useToast } from "@/hooks/use-toast";
import {
	useDeleteSchedule,
	useRunScheduleNow,
	useSchedule,
} from "@/lib/api/hooks/use-schedules-orpc";
import { useThreadStatuses } from "@/lib/api/hooks/use-threads-orpc";
import { scheduleWhen } from "@/lib/format-time";
import { getErrorMessage } from "@/lib/get-error-message";
import { infoReason, STATUS_WORD } from "@/lib/thread-status";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/schedules/$id")({
	component: ScheduleHistoryPage,
});

/** A schedule and every slot it decided, each linking to its run (#979). */
function ScheduleHistoryPage() {
	const { id } = Route.useParams();
	const { data, isLoading, error, refetch } = useSchedule(id);
	const navigate = useNavigate();
	const { toast } = useToast();
	const runNow = useRunScheduleNow();
	const remove = useDeleteSchedule();
	const [editing, setEditing] = useState(false);
	const [duplicating, setDuplicating] = useState(false);
	const [deleting, setDeleting] = useState(false);
	const older = useOlderTicks(id, (e) =>
		toast({
			title: "Could not load older runs",
			description: getErrorMessage(e),
			variant: "destructive",
		}),
	);
	usePageTitle(data?.schedule.name ?? "Schedule");

	const runStatuses = useThreadStatuses(
		[...(data?.ticks ?? []), ...older.ticks].flatMap((t) =>
			t.run ? [t.run.id] : [],
		),
	);
	if (isLoading) return <Loading />;
	if (error && !data) {
		const missing = (error as { code?: string }).code === "NOT_FOUND";
		return missing ? (
			<NotFound
				text="This schedule no longer exists."
				back={<Link to="/automation">Automation</Link>}
			/>
		) : (
			<Problem text={getErrorMessage(error)} onRetry={() => void refetch()} />
		);
	}
	if (!data) return null;
	const { schedule: s, ticks, canEdit, hostName } = data;
	const latest = ticks[0];
	const start = () =>
		runNow.mutate(
			{ id: s.id },
			{
				onError: (e) =>
					toast({
						title: "Not started",
						description: getErrorMessage(e),
						variant: "destructive",
					}),
			},
		);

	return (
		<div className="flex h-full min-h-0 flex-col">
			<header
				data-title-row
				className="flex min-h-(--header-h) shrink-0 items-center gap-2 bg-surface-1 py-1.5 pr-3 pl-2"
			>
				<Button
					variant="ghost"
					size="icon-lg"
					aria-label="Back to Schedules"
					asChild
				>
					<Link to="/schedules">
						<ChevronLeft />
					</Link>
				</Button>
				<h1 className="min-w-0 flex-1 truncate text-title">{s.name}</h1>
				{canEdit ? (
					<>
						<Button
							variant="secondary"
							onClick={start}
							disabled={runNow.isPending || !!s.liveRunId}
						>
							<Play />
							<span className="max-sm:sr-only">Run now</span>
						</Button>
						<Button variant="secondary" onClick={() => setEditing(true)}>
							<Pencil />
							<span className="max-sm:sr-only">Edit</span>
						</Button>
						<DropdownMenu>
							<DropdownMenuTrigger asChild>
								<Button variant="ghost" size="icon-lg" aria-label="More">
									<MoreHorizontal />
								</Button>
							</DropdownMenuTrigger>
							<DropdownMenuContent align="end">
								<DropdownMenuItem onSelect={() => setDuplicating(true)}>
									<Copy />
									Duplicate
								</DropdownMenuItem>
								<DropdownMenuItem
									className="text-danger"
									onSelect={() => setDeleting(true)}
								>
									<Trash2 />
									Delete schedule
								</DropdownMenuItem>
							</DropdownMenuContent>
						</DropdownMenu>
					</>
				) : (
					<span className="inline-flex items-center gap-1.5 text-meta text-text-3">
						<Lock className="size-3.5" />
						<span className="max-sm:sr-only">View only</span>
					</span>
				)}
			</header>

			<div className="min-h-0 flex-1 overflow-y-auto px-4 pb-6 @container">
				<div className="mx-auto grid max-w-(--reading-w) gap-5 pt-1">
					{!canEdit && <HostOnlyNote hostName={hostName} />}
					{!s.enabled && s.pausedReason && (
						<Note tone="warn" icon={<TriangleAlert />}>
							{s.pausedReason}
						</Note>
					)}
					{latest && (
						<LatestNote
							tick={latest}
							schedule={s}
							canEdit={canEdit}
							onRun={start}
						/>
					)}
					<Facts schedule={s} />
					<section>
						<h2 className="mb-1.5 ml-1 text-heading text-text-2">Runs</h2>
						{ticks.length === 0 ? (
							<p className="px-1 text-body text-text-3">
								No runs yet. The first is{" "}
								{whenText(s.nextRunAt) || "when you resume it"}.
							</p>
						) : (
							<div className="flex flex-col" data-testid="schedule-ticks">
								{[...ticks, ...older.ticks].map((t) => (
									<TickRow
										key={t.id}
										tick={t}
										info={
											t.run ? runStatuses.data?.statuses[t.run.id] : undefined
										}
									/>
								))}
							</div>
						)}
						{!older.done && (older.cursor ?? data.nextCursor) && (
							<Button
								variant="ghost"
								className="mt-2"
								disabled={older.loading}
								onClick={() => older.more(older.cursor ?? data.nextCursor)}
							>
								Show older runs
							</Button>
						)}
					</section>
				</div>
			</div>

			{canEdit && (
				<>
					<ScheduleDialog
						open={editing}
						onOpenChange={setEditing}
						editing={s}
						canSetHostZone
					/>
					<ScheduleDialog
						open={duplicating}
						onOpenChange={setDuplicating}
						copyOf={s}
						canSetHostZone
					/>
					<DestructiveConfirm
						open={deleting}
						onOpenChange={setDeleting}
						title={`Delete ${s.name}?`}
						description="Its runs stay where they are. Nothing runs on this schedule again."
						confirmLabel="Delete schedule"
						onConfirm={() =>
							remove.mutate(
								{ id: s.id },
								{ onSuccess: () => navigate({ to: "/schedules" }) },
							)
						}
					/>
				</>
			)}
		</div>
	);
}

function Note({
	tone,
	icon,
	children,
}: {
	tone: "bad" | "warn";
	icon: React.ReactNode;
	children: React.ReactNode;
}) {
	return (
		<div
			role="status"
			className="flex items-start gap-2.5 rounded-pool bg-surface-2 px-3.5 py-3 text-body text-text-1"
		>
			<span
				className={cn(
					"mt-0.5 shrink-0 [&_svg]:size-4",
					tone === "bad" ? "text-danger" : "text-warn",
				)}
			>
				{icon}
			</span>
			<div className="min-w-0">{children}</div>
		</div>
	);
}

/** The newest slot gets a sentence when it failed or ran late (#979 mockups). */
function LatestNote({
	tick,
	schedule,
	canEdit,
	onRun,
}: {
	tick: ScheduleTick;
	schedule: Schedule;
	canEdit: boolean;
	onRun: () => void;
}) {
	const note = latestNote(tick);
	if (note === "failed" && tick.run)
		return (
			<Note tone="bad" icon={<TriangleAlert />}>
				<strong>The last run failed.</strong>{" "}
				{tick.run.error ?? "The run stopped."}{" "}
				{schedule.enabled && schedule.nextRunAt
					? `The next run is still due ${whenText(schedule.nextRunAt)}.`
					: ""}
				<div className="mt-2 flex flex-wrap gap-2">
					<Button variant="secondary" asChild>
						<Link to="/investigations/$id" params={{ id: tick.run.id }}>
							Open the run
						</Link>
					</Button>
					{canEdit && (
						<Button variant="ghost" onClick={onRun}>
							<Play />
							Run now
						</Button>
					)}
				</div>
			</Note>
		);
	if (note === "asleep")
		return (
			<Note tone="warn" icon={<Moon />}>
				This computer was asleep at {clock(tick.scheduledFor)}. PrismaLens ran
				the check once when it woke, at {clock(tick.decidedAt)}.
			</Note>
		);
	return null;
}

function Facts({ schedule: s }: { schedule: Schedule }) {
	const items: Array<[string, string, string]> = [
		["Runs", aboutText(s), s.runbook ? `Runbook ${s.runbook}` : ""],
		[
			"When",
			scheduleWhen(s),
			s.enabled ? `Next ${whenText(s.nextRunAt)}` : "Paused",
		],
		[
			"Agent",
			[s.harness, s.model].filter(Boolean).join(", "),
			`${ACCESS_LEVEL_LABEL[s.accessLevel ?? AUTO_START_ACCESS_LEVEL]} access`,
		],
		[
			"If missed",
			s.missedPolicy === "run_once" ? "Run once when back" : "Skip it",
			s.missedPolicy === "run_once"
				? `Within ${s.catchUpMinutes / 60} hours`
				: "",
		],
	];
	return (
		<dl className="grid grid-cols-1 gap-0.5 overflow-hidden rounded-pool bg-surface-2 @lg:grid-cols-2 @3xl:grid-cols-4">
			{items.map(([k, v, sub]) => (
				<div key={k} className="px-3.5 py-3">
					<dt className="text-meta text-text-3">{k}</dt>
					<dd className="text-heading">{v}</dd>
					{sub && <dd className="text-meta text-text-3">{sub}</dd>}
				</div>
			))}
		</dl>
	);
}

/** One run as a quiet row; a Limited or Blocked run says so with its cause, never "Failed" (#1101). */
function TickRow({
	tick,
	info,
}: {
	tick: ScheduleTick;
	info?: ThreadStatusInfo;
}) {
	const base = tickLine(tick, clock);
	const stop = info && (info.status === "limited" || info.status === "blocked");
	const line = stop
		? {
				...base,
				status: info.status,
				text: [STATUS_WORD[info.status], infoReason(info, Date.now())]
					.filter(Boolean)
					.join(": "),
			}
		: base;
	const unseen = tick.run?.unseen === true;
	return (
		<div
			className="grid min-h-11 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-0.5 px-1 py-1.5 @3xl:grid-cols-[150px_minmax(0,1fr)_80px_auto]"
			data-testid="schedule-tick"
			data-unseen={unseen}
		>
			<span
				className={cn(
					"flex items-center gap-1.5 text-meta",
					unseen ? "font-medium text-text-1" : "text-text-3",
				)}
			>
				{whenText(tick.scheduledFor)}
				{unseen && <span className="sr-only">, unread</span>}
			</span>
			<span className="col-start-1 flex min-w-0 text-body @3xl:col-start-auto">
				<Status kind={line.status} word={line.text} className="min-w-0" />
			</span>
			<span className="hidden text-meta text-text-3 @3xl:block">
				{durationText(
					tick.run?.startedAt ?? null,
					tick.run?.completedAt ?? null,
				)}
			</span>
			<span className="col-start-2 row-span-2 row-start-1 @3xl:col-start-auto @3xl:row-span-1 @3xl:row-start-auto">
				{line.link &&
					(line.link.kind === "incident" ? (
						<Link
							to="/incidents/$id"
							params={{ id: line.link.id }}
							className="inline-flex min-h-8 items-center text-meta text-text-2 hover:text-text-1 max-sm:min-h-11"
						>
							{line.link.label}
						</Link>
					) : (
						<Link
							to="/investigations/$id"
							params={{ id: line.link.id }}
							className="inline-flex min-h-8 items-center text-meta text-text-2 hover:text-text-1 max-sm:min-h-11"
						>
							{line.link.label}
						</Link>
					))}
			</span>
		</div>
	);
}
