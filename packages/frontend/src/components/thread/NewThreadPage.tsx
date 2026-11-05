// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { Severity, ThreadStartSubject } from "@prismalens/contracts";
import { useNavigate } from "@tanstack/react-router";
import { Siren, SquarePen } from "lucide-react";
import { useState } from "react";
import {
	ScheduleDialog,
	type SchedulePrefill,
} from "@/components/schedules/ScheduleDialog";
import {
	Select,
	SelectContent,
	SelectGroup,
	SelectItem,
	SelectLabel,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { usePageTitle } from "@/hooks/use-page-title";
import { useRepositories, useServices } from "@/lib/api/hooks";
import { useSchedules } from "@/lib/api/hooks/use-schedules-orpc";
import { cn } from "@/lib/utils";
import { NewThread } from "./NewThread";

export interface NewThreadSearch {
	project?: string;
	service?: string;
	incident?: boolean;
	severity?: Severity;
	note?: boolean;
}

const SEVERITIES: Severity[] = ["critical", "high", "medium", "low", "info"];
const SEVERITY_WORD: Record<Severity, string> = {
	critical: "Critical",
	high: "High",
	medium: "Medium",
	low: "Low",
	info: "Info",
};

export function subjectOf(search: NewThreadSearch): ThreadStartSubject {
	if (search.project) return { kind: "project", repositoryId: search.project };
	if (search.service) return { kind: "service", serviceId: search.service };
	return { kind: "none" };
}

/**
 * New thread (#1020): the composer with its top row, a subject picker and the
 * Incident toggle. The choices live in the URL, so `c` can open it with
 * Incident on and Back keeps them.
 */
export function NewThreadPage({ search }: { search: NewThreadSearch }) {
	usePageTitle("New thread");
	const navigate = useNavigate();
	const repos = useRepositories({ limit: 100 });
	const services = useServices({ limit: 100 });
	// Only the host saves a schedule, so only the host is offered Repeat… (#1020).
	const canSchedule = useSchedules().data?.canEdit === true;
	const [repeat, setRepeat] = useState<SchedulePrefill | null>(null);
	const set = (next: Partial<NewThreadSearch>) =>
		void navigate({
			to: "/threads/new",
			search: (prev: NewThreadSearch) => ({ ...prev, ...next }),
			replace: true,
		});
	const subject = subjectOf(search);
	// An incident carries a service, not a project (the contract has no repositoryId): #1020.
	const incidentOff = !!search.project;
	const incident =
		search.incident && !incidentOff ? (search.severity ?? "high") : null;
	const value = search.project
		? `project:${search.project}`
		: search.service
			? `service:${search.service}`
			: "none";
	const repo = repos.data?.data.find((r) => r.id === search.project);

	const top = (
		<div
			className="flex flex-wrap items-center gap-1.5 px-0.5"
			data-testid="composer-top"
		>
			<Select
				value={value}
				onValueChange={(v) => {
					const [kind, id] = v.split(":");
					set({
						project: kind === "project" ? id : undefined,
						service: kind === "service" ? id : undefined,
						...(kind === "project"
							? { incident: undefined, note: undefined }
							: {}),
					});
				}}
			>
				<SelectTrigger
					aria-label="Subject"
					className="max-w-64 text-meta"
					data-testid="composer-subject"
				>
					<SelectValue />
				</SelectTrigger>
				<SelectContent>
					<SelectItem value="none" data-testid="subject-none">
						No project
					</SelectItem>
					{(repos.data?.data ?? []).length > 0 && (
						<SelectGroup>
							<SelectLabel>Projects</SelectLabel>
							{repos.data?.data.map((r) => (
								<SelectItem
									key={r.id}
									value={`project:${r.id}`}
									data-testid={`subject-project-${r.id}`}
								>
									{r.fullName}
								</SelectItem>
							))}
						</SelectGroup>
					)}
					{(services.data?.data ?? []).length > 0 && (
						<SelectGroup>
							<SelectLabel>Services</SelectLabel>
							{services.data?.data.map((sv) => (
								<SelectItem
									key={sv.id}
									value={`service:${sv.id}`}
									data-testid={`subject-service-${sv.id}`}
								>
									{sv.displayName || sv.name}
								</SelectItem>
							))}
						</SelectGroup>
					)}
				</SelectContent>
			</Select>
			<button
				type="button"
				aria-pressed={!!incident}
				disabled={incidentOff}
				title={incidentOff ? "Incidents attach to a service" : undefined}
				onClick={() =>
					set({ incident: search.incident ? undefined : true, note: undefined })
				}
				className={cn(
					"inline-flex h-7 items-center gap-1.5 rounded-control px-2 text-meta transition-colors duration-(--dur-instant)",
					incident
						? "bg-surface-3 font-medium text-text-1"
						: "bg-surface-2 text-text-2 hover:text-text-1",
					incidentOff && "cursor-not-allowed opacity-50",
				)}
				data-testid="composer-incident"
			>
				<Siren aria-hidden className="size-3.5" />
				Incident
			</button>
			{incident && (
				<Select
					value={incident}
					onValueChange={(v) => set({ severity: v as Severity })}
				>
					<SelectTrigger
						aria-label="Severity"
						className="text-meta"
						data-testid="composer-severity"
					>
						<SelectValue />
					</SelectTrigger>
					<SelectContent>
						{SEVERITIES.map((sv) => (
							<SelectItem key={sv} value={sv} data-testid={`severity-${sv}`}>
								{SEVERITY_WORD[sv]}
							</SelectItem>
						))}
					</SelectContent>
				</Select>
			)}
			{search.note && incident && (
				<span className="text-meta text-text-3" data-testid="composer-note">
					Note only
				</span>
			)}
		</div>
	);

	return (
		<div
			className="flex h-full flex-col bg-canvas"
			data-testid="new-thread-page"
		>
			<header
				data-title-row
				className="flex min-h-(--header-h) shrink-0 items-center gap-2 bg-surface-1 py-1.5 pr-3 pl-4"
			>
				<SquarePen className="size-4 shrink-0 text-text-3" aria-hidden />
				<h1 className="min-w-0 flex-1 truncate text-title">New thread</h1>
			</header>
			<div className="flex min-h-0 flex-1 flex-col justify-center overflow-y-auto px-4 pb-6">
				<div className="mx-auto w-full max-w-(--reading-w)">
					<NewThread
						subject={subject}
						branch={repo?.defaultBranch ?? null}
						incident={incident}
						note={!!search.note}
						top={top}
						{...(canSchedule ? { onRepeat: setRepeat } : {})}
						slash={
							incidentOff
								? []
								: [
										{
											id: "investigate",
											label: "Investigate",
											run: () => set({ incident: true, note: undefined }),
										},
										{
											id: "note",
											label: "Note",
											run: () => set({ incident: true, note: true }),
										},
									]
						}
					/>
				</div>
			</div>
			{repeat && (
				<ScheduleDialog
					open
					onOpenChange={(open) => {
						if (!open) setRepeat(null);
					}}
					prefill={repeat}
					canSetHostZone
				/>
			)}
		</div>
	);
}
