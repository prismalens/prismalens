// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { Severity, ThreadStartSubject } from "@prismalens/contracts";
import { Link } from "@tanstack/react-router";
import { ChevronDown, FolderOpen, Siren } from "lucide-react";
import { useState } from "react";
import { useSetupProgress } from "@/components/incidents/FirstRunPanel";
import {
	ScheduleDialog,
	type SchedulePrefill,
} from "@/components/schedules/ScheduleDialog";
import { codeWhere } from "@/components/services/service-detail.utils";
import { Hint } from "@/components/shared/Hint";
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
import { lastSubject, subjectMenu } from "@/lib/last-subject";
import { cn } from "@/lib/utils";
import { AwayStrip } from "./AwayStrip";

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
 * Home (#1020): one question over one box, generic first (sheet §1, #1101).
 * Nothing is assumed: the subject, the Incident toggle and the code hint
 * show once the user picks a project or a service.
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
	const services = useServices({ limit: 100 }).data?.data ?? [];
	const repos = useRepositories({ limit: 100 }).data?.data ?? [];
	// Only the host saves a schedule, so only the host is offered Repeat… (#1020).
	const canSchedule = useSchedules().data?.canEdit === true;
	const [repeat, setRepeat] = useState<SchedulePrefill | null>(null);
	const picked = search;
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
	const chosen = !!(picked.project || picked.service);
	const subjectPicker = (icon: boolean) => (
		<SubjectPicker
			icon={icon}
			value={
				picked.project
					? `project:${picked.project}`
					: picked.service
						? `service:${picked.service}`
						: "none"
			}
			label={
				repo?.fullName ??
				(service ? service.displayName || service.name : "No project")
			}
			projects={repos.map((r) => ({ id: r.id, name: r.fullName }))}
			services={services.map((s) => ({
				id: s.id,
				name: s.displayName || s.name,
			}))}
			onPick={pick}
		/>
	);

	return (
		<div
			className="mx-auto flex w-full max-w-[680px] flex-col gap-4 px-4 pt-[18vh] pb-12"
			data-testid="home"
		>
			<div className="flex flex-col items-center gap-1">
				<h2 className="text-center text-display text-text-1">
					What should we work on?
				</h2>
				{chosen && (
					// The subject is a quiet line under the question, so a long name never outweighs it.
					<p className="flex items-center gap-1 text-body text-text-3">
						in {subjectPicker(false)}
					</p>
				)}
			</div>
			<NewThread
				subject={subject}
				branch={repo?.defaultBranch ?? null}
				incident={incident}
				note={!!search.note}
				top={service || incident ? top : undefined}
				tools={subjectPicker(true)}
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
			<AwayStrip />
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
	icon,
	value,
	label,
	projects,
	services,
	onPick,
}: {
	/** In the composer's tools: an icon, opening upward; otherwise the line's text. */
	icon: boolean;
	value: string;
	label: string;
	projects: { id: string; name: string }[];
	services: { id: string; name: string }[];
	onPick: (value: string) => void;
}) {
	// Read when the menu renders, so a send in this tab shows up next time.
	const menu = subjectMenu(projects, services, lastSubject());
	return (
		<DropdownMenu>
			{icon ? (
				<Hint label="Project or service" side="top">
					<DropdownMenuTrigger
						className="flex size-8 items-center justify-center rounded-control text-text-3 outline-none hover:bg-surface-3 hover:text-text-1 focus-visible:ring-2 focus-visible:ring-accent data-[state=open]:bg-surface-3"
						aria-label={`Project or service: ${label}`}
						data-testid="composer-subject-tool"
					>
						<FolderOpen className="size-3.5" />
					</DropdownMenuTrigger>
				</Hint>
			) : (
				<DropdownMenuTrigger
					className="inline-flex min-h-6 max-w-[28rem] items-center gap-1 rounded-control px-1.5 text-text-1 outline-none hover:bg-surface-3 focus-visible:ring-2 focus-visible:ring-accent"
					aria-label={`Subject: ${label}`}
					data-testid="composer-subject"
				>
					<span className="truncate">{label}</span>
					<ChevronDown className="size-4 self-center text-text-3" />
				</DropdownMenuTrigger>
			)}
			<DropdownMenuContent
				align={icon ? "start" : "center"}
				side={icon ? "top" : "bottom"}
			>
				<DropdownMenuRadioGroup value={value} onValueChange={onPick}>
					{menu.first && (
						<DropdownMenuRadioItem
							value={menu.first.value}
							data-testid="subject-last"
						>
							{menu.first.name}
						</DropdownMenuRadioItem>
					)}
					<DropdownMenuRadioItem value="none" data-testid="subject-none">
						No project
					</DropdownMenuRadioItem>
					{menu.projects.length > 0 && (
						<DropdownMenuLabel>Projects</DropdownMenuLabel>
					)}
					{menu.projects.map((p) => (
						<DropdownMenuRadioItem
							key={p.id}
							value={`project:${p.id}`}
							data-testid={`subject-project-${p.id}`}
						>
							{p.name}
						</DropdownMenuRadioItem>
					))}
					{menu.services.length > 0 && (
						<DropdownMenuLabel>Services</DropdownMenuLabel>
					)}
					{menu.services.map((s) => (
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
	) : service && !p.alertsIn ? (
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
