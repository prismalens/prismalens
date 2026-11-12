// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { Severity, ThreadStartSubject } from "@prismalens/contracts";
import { Link } from "@tanstack/react-router";
import { ChevronDown, Siren } from "lucide-react";
import { useState } from "react";
import { useActiveIncidents } from "@/components/inbox/use-inbox-data";
import { useSetupProgress } from "@/components/incidents/FirstRunPanel";
import {
	ScheduleDialog,
	type SchedulePrefill,
} from "@/components/schedules/ScheduleDialog";
import { codeWhere } from "@/components/services/service-detail.utils";
import { NewThread } from "@/components/thread/NewThread";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuRadioGroup,
	DropdownMenuRadioItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { useRepositories, useServices } from "@/lib/api/hooks";
import { useSchedules } from "@/lib/api/hooks/use-schedules-orpc";
import { cn } from "@/lib/utils";
import { AwayView } from "./AwayView";

/** Home's choices; on `/new` they live in the URL, so `c` opens it with Incident on. */
export interface NewThreadSearch {
	project?: string;
	service?: string;
	/** No subject, picked on purpose: the recent service is not assumed. */
	none?: boolean;
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
 * Home (#1020): one question over one box. The subject is a quiet choice under
 * the question (a project, a service or nothing); Incident turns the message
 * into an incident's brief. Without a pick, the service touched last is meant.
 */
export function HomeComposer({
	search: given,
	onSearch,
}: {
	search?: NewThreadSearch;
	onSearch?: (next: Partial<NewThreadSearch>) => void;
}) {
	const [local, setLocal] = useState<NewThreadSearch>({});
	const search = given ?? local;
	const set =
		onSearch ??
		((next: Partial<NewThreadSearch>) =>
			setLocal((prev) => ({ ...prev, ...next })));
	const servicesPage = useServices({ limit: 100 }).data;
	const services = servicesPage?.data ?? [];
	const repos = useRepositories({ limit: 100 }).data?.data ?? [];
	// Only the host saves a schedule, so only the host is offered Repeat… (#1020).
	const canSchedule = useSchedules().data?.canEdit === true;
	const [repeat, setRepeat] = useState<SchedulePrefill | null>(null);
	const { incidents } = useActiveIncidents();
	const recent = [...incidents]
		.sort(
			(a, b) =>
				Date.parse(b.updatedAt ?? b.triggeredAt) -
				Date.parse(a.updatedAt ?? a.triggeredAt),
		)
		.map((i) => services.find((s) => s.id === i.serviceId))
		.filter((s): s is (typeof services)[number] => !!s);
	const assumed =
		search.project || search.service || search.none
			? undefined
			: (recent.find((s) => codeWhere(s)) ??
				recent[0] ??
				services.find((s) => codeWhere(s)) ??
				services[0]);
	const picked: NewThreadSearch = assumed
		? { ...search, service: assumed.id }
		: search;
	const subject = subjectOf(picked);
	const repo = repos.find((r) => r.id === picked.project);
	const service = services.find((s) => s.id === picked.service);
	// An incident carries a service, not a project (the contract has no repositoryId): #1020.
	const incidentOff = !!picked.project;
	const incident =
		search.incident && !incidentOff ? (search.severity ?? "high") : null;
	const pick = (v: string) => {
		const [kind, id] = v.split(":");
		set({
			project: kind === "project" ? id : undefined,
			service: kind === "service" ? id : undefined,
			none: kind === "none" ? true : undefined,
			...(kind === "project" ? { incident: undefined, note: undefined } : {}),
		});
	};
	const top = (
		<div
			className="flex flex-wrap items-center gap-1.5 px-0.5"
			data-testid="composer-top"
		>
			<button
				type="button"
				aria-pressed={!!incident}
				disabled={incidentOff}
				aria-label={incidentOff ? "Incident: needs a service" : undefined}
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
	const nothing = !!servicesPage && services.length === 0 && repos.length === 0;

	return (
		<div
			className="mx-auto flex w-full max-w-[680px] flex-col gap-4 px-4 pt-[18vh] pb-12"
			data-testid="home"
		>
			<div className="flex flex-col items-center gap-1">
				<h2 className="text-center text-display text-text-1">
					What should we look into?
				</h2>
				{!nothing && (
					// The subject is a quiet choice under the question, so a long name never outweighs it.
					<p className="flex items-center gap-1 text-body text-text-3">
						in
						<SubjectPicker
							value={
								picked.project
									? `project:${picked.project}`
									: picked.service
										? `service:${picked.service}`
										: "none"
							}
							label={
								repo?.fullName ??
								(service ? service.displayName || service.name : "no project")
							}
							projects={repos.map((r) => ({ id: r.id, name: r.fullName }))}
							services={services.map((s) => ({
								id: s.id,
								name: s.displayName || s.name,
							}))}
							onPick={pick}
						/>
					</p>
				)}
			</div>
			{nothing && (
				<p className="-mt-2 self-center text-body text-text-3">
					Ask now, or{" "}
					<Link
						to="/services"
						search={{ add: "1" }}
						className="inline-flex min-h-6 items-center text-text-2 hover:text-text-1 hover:underline"
						data-testid="home-add-folder"
					>
						add a service
					</Link>{" "}
					so the agent can read its code.
				</p>
			)}
			<NewThread
				subject={subject}
				branch={repo?.defaultBranch ?? null}
				incident={incident}
				note={!!search.note}
				top={top}
				placeholder="Ask anything"
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
			<SetupHint service={service ?? null} />
			<AwayView />
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

function SubjectPicker({
	value,
	label,
	projects,
	services,
	onPick,
}: {
	value: string;
	label: string;
	projects: { id: string; name: string }[];
	services: { id: string; name: string }[];
	onPick: (value: string) => void;
}) {
	return (
		<DropdownMenu>
			<DropdownMenuTrigger
				className="inline-flex min-h-6 max-w-[28rem] items-center gap-1 rounded-control px-1.5 text-text-1 outline-none hover:bg-surface-3 focus-visible:ring-2 focus-visible:ring-accent"
				aria-label={`Subject: ${label}`}
				data-testid="composer-subject"
			>
				<span className="truncate">{label}</span>
				<ChevronDown className="size-4 self-center text-text-3" />
			</DropdownMenuTrigger>
			<DropdownMenuContent align="center">
				<DropdownMenuRadioGroup value={value} onValueChange={onPick}>
					<DropdownMenuRadioItem value="none" data-testid="subject-none">
						No project
					</DropdownMenuRadioItem>
					{projects.length > 0 && (
						<DropdownMenuLabel>Projects</DropdownMenuLabel>
					)}
					{projects.map((p) => (
						<DropdownMenuRadioItem
							key={p.id}
							value={`project:${p.id}`}
							data-testid={`subject-project-${p.id}`}
						>
							{p.name}
						</DropdownMenuRadioItem>
					))}
					{services.length > 0 && (
						<DropdownMenuLabel>Services</DropdownMenuLabel>
					)}
					{services.map((s) => (
						<DropdownMenuRadioItem
							key={s.id}
							value={`service:${s.id}`}
							data-testid={`subject-service-${s.id}`}
						>
							{s.name}
						</DropdownMenuRadioItem>
					))}
				</DropdownMenuRadioGroup>
				<DropdownMenuSeparator />
				<DropdownMenuItem asChild>
					<Link to="/projects" search={{ add: true }}>
						Add project
					</Link>
				</DropdownMenuItem>
				<DropdownMenuItem asChild>
					<Link to="/services" search={{ add: "1" }}>
						Add a service
					</Link>
				</DropdownMenuItem>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}

/**
 * One quiet line for the first missing step; gone once setup is done. The
 * code step is about the picked service only; alerts, an optional trigger, come last.
 */
function SetupHint({
	service,
}: {
	service: { id: string; name: string } | null;
}) {
	const p = useSetupProgress();
	if (!p.loaded) return null;
	const noCode =
		service && !codeWhere(service as Parameters<typeof codeWhere>[0]);
	const link = !p.steps.agent ? (
		<Link to="/settings" search={{ tab: "agent" }}>
			Set up
		</Link>
	) : noCode && service ? (
		<Link to="/services/$id" params={{ id: service.id }}>
			Link code
		</Link>
	) : !p.alertsIn ? (
		<Link to="/alerts">Connect</Link>
	) : null;
	if (!link) return null;
	const what = !p.steps.agent
		? "No agent ready."
		: noCode && service
			? "The agent can't read this service's code yet."
			: "Alerts not connected.";
	return (
		<p
			className="text-center text-body text-text-2 [&_a]:inline-flex [&_a]:min-h-6 [&_a]:items-center [&_a]:text-accent [&_a]:underline [&_a]:underline-offset-2"
			data-testid="setup-line"
		>
			{what} {link}
		</p>
	);
}
