// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { ThreadStartSubject } from "@prismalens/contracts";
import { CalendarClock, GitPullRequest, Newspaper, Radar } from "lucide-react";
import { type ReactNode, useState } from "react";
import { ListCard, ListGrid } from "@/components/kit";
import { Hint } from "@/components/shared/Hint";
import { useSchedules } from "@/lib/api/hooks/use-schedules-orpc";
import { cn } from "@/lib/utils";
import { ScheduleDialog, type SchedulePrefill } from "./ScheduleDialog";

export interface ScheduleTemplate {
	id: "watch-service" | "daily-digest" | "recheck-pr";
	title: string;
	/** What it does and when, in one line. */
	line: string;
	icon: ReactNode;
	prefill: (subject: ThreadStartSubject, prUrl?: string) => SchedulePrefill;
}

/** Starting points for a new schedule (#1101 category 22 item 4). */
export const SCHEDULE_TEMPLATES: ScheduleTemplate[] = [
	{
		id: "watch-service",
		title: "Watch a service",
		line: "Every 2 hours, new errors",
		icon: <Radar className="size-3.5" aria-hidden />,
		prefill: (subject) => ({
			name: "Watch a service",
			subject,
			brief:
				"Check this service's recent errors, alerts and deploys. Say whether anything new is wrong, with the evidence, or that nothing is.",
			when: { preset: "hours", everyHours: 2 },
			report: true,
		}),
	},
	{
		id: "daily-digest",
		title: "Daily digest",
		line: "Weekdays at 09:00, what changed",
		icon: <Newspaper className="size-3.5" aria-hidden />,
		prefill: (subject) => ({
			name: "Daily digest",
			subject,
			brief:
				"Summarize what changed since yesterday: incidents, alerts, deploys and open pull requests. Lead with anything that needs me.",
			when: { preset: "weekdays", time: "09:00", days: [1, 2, 3, 4, 5] },
			report: false,
		}),
	},
	{
		id: "recheck-pr",
		title: "Re-check a PR",
		line: "Every hour, checks and reviews",
		icon: <GitPullRequest className="size-3.5" aria-hidden />,
		prefill: (subject, prUrl) => ({
			name: "Re-check a PR",
			subject,
			brief: `Re-check the pull request ${prUrl ?? "(paste its link here)"}: its checks, open review threads and merge state. Say what blocks the merge and the next command.`,
			when: { preset: "hours", everyHours: 1 },
			report: false,
		}),
	},
];

/** The templates as cards; each opens New schedule filled in. Host only. */
export function ScheduleTemplates({
	subject = { kind: "none" },
	className,
}: {
	subject?: ThreadStartSubject;
	className?: string;
}) {
	const { data } = useSchedules();
	const [prefill, setPrefill] = useState<SchedulePrefill | null>(null);
	if (!data?.canEdit) return null;
	return (
		<section className={className} data-testid="schedule-templates">
			<h2 className="mb-1.5 ml-1 text-heading text-text-2">
				Start from a template
			</h2>
			<ListGrid label="Templates">
				{SCHEDULE_TEMPLATES.map((t) => (
					<ListCard
						key={t.id}
						title={t.title}
						icon={t.icon}
						meta={t.line}
						onOpen={() => setPrefill(t.prefill(subject))}
						testId={`schedule-template-${t.id}`}
					/>
				))}
			</ListGrid>
			<ScheduleDialog
				open={!!prefill}
				onOpenChange={(o) => !o && setPrefill(null)}
				prefill={prefill ?? undefined}
				canSetHostZone
			/>
		</section>
	);
}

/**
 * "Add scheduled task" from a thread (#1101 category 22 item 3): its subject, and a
 * re-check of its PR when it has one, else a follow-up on the thread. Host only.
 */
export function AddScheduleFromThread({
	title,
	subject,
	prUrl,
	className,
}: {
	title: string | null;
	subject: ThreadStartSubject;
	prUrl?: string;
	className?: string;
}) {
	const { data } = useSchedules();
	const [open, setOpen] = useState(false);
	if (!data?.canEdit) return null;
	const recheck = SCHEDULE_TEMPLATES[2] as ScheduleTemplate;
	const prefill: SchedulePrefill = prUrl
		? recheck.prefill(subject, prUrl)
		: {
				name: `Follow up: ${title ?? "thread"}`.slice(0, 120),
				subject,
				brief: `Follow up on the thread "${title ?? "untitled"}": check whether what it found still holds, and say what changed since.`,
				when: { preset: "daily", time: "09:00" },
				report: false,
			};
	return (
		<>
			<Hint label="Add scheduled task">
				<button
					type="button"
					aria-label="Add scheduled task"
					onClick={() => setOpen(true)}
					className={cn(
						"flex size-7 shrink-0 items-center justify-center rounded-control bg-surface-2 text-text-2 transition-colors duration-(--dur-instant) hover:bg-surface-3",
						className,
					)}
					data-testid="thread-add-schedule"
				>
					<CalendarClock className="size-4" aria-hidden />
				</button>
			</Hint>
			<ScheduleDialog
				open={open}
				onOpenChange={setOpen}
				prefill={open ? prefill : undefined}
				canSetHostZone
			/>
		</>
	);
}
