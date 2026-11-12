// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { Severity, ThreadStartSubject } from "@prismalens/contracts";
import { Link, useNavigate } from "@tanstack/react-router";
import {
	Bot,
	Boxes,
	FolderGit2,
	MessageSquare,
	Plus,
	Siren,
} from "lucide-react";
import { useState } from "react";
import { AgentMark } from "@/components/agent/AgentMark";
import {
	CHIP,
	unreadyReason,
	useAgentChoice,
} from "@/components/agent/AgentPicker";
import { Mark, markLook, Picker, type PickerOption } from "@/components/kit";
import {
	ScheduleDialog,
	type SchedulePrefill,
} from "@/components/schedules/ScheduleDialog";
import { codeWhere } from "@/components/services/service-detail.utils";
import { Hint } from "@/components/shared/Hint";
import { NewThread } from "@/components/thread/NewThread";
import { useRepositories, useServices } from "@/lib/api/hooks";
import { useSchedules } from "@/lib/api/hooks/use-schedules-orpc";
import { lastSubject, subjectMenu } from "@/lib/last-subject";
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
 * Home (#1020): the cursor in one box under one row of chips, each a mark:
 * the subject (and whether its code is linked), the agent's readiness and,
 * once a service is picked, Incident. Nothing is assumed (sheet §1, #1101).
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
			className="flex flex-wrap items-center gap-0.5"
			data-testid="composer-top"
		>
			<SubjectPicker
				value={
					picked.project
						? `project:${picked.project}`
						: picked.service
							? `service:${picked.service}`
							: "none"
				}
				projects={repos.map((r) => ({ id: r.id, name: r.fullName }))}
				services={services.map((s) => ({
					id: s.id,
					name: s.displayName || s.name,
				}))}
				onPick={pick}
			/>
			{service && !codeWhere(service) && (
				<Link
					to="/services/$id"
					params={{ id: service.id }}
					aria-label="No code linked: link it"
					className={cn(CHIP, "px-2")}
					data-testid="composer-code"
				>
					<Mark id="code" state="missing" word="No code linked" />
				</Link>
			)}
			<AgentReady />
			{(service || incident) && (
				<button
					type="button"
					aria-pressed={!!incident}
					disabled={incidentOff}
					aria-label={incidentOff ? "Incident: needs a service" : undefined}
					onClick={() =>
						set({
							incident: search.incident ? undefined : true,
							note: undefined,
						})
					}
					className={cn(
						CHIP,
						"gap-1.5",
						incident && "bg-surface-3 text-text-1",
						incidentOff && "cursor-not-allowed opacity-50",
					)}
					data-testid="composer-incident"
				>
					<Siren aria-hidden className="size-3.5" />
					Incident
				</button>
			)}
			{incident && (
				<Picker
					label="Severity"
					side="bottom"
					value={incident}
					onChange={(id) => set({ severity: id as Severity })}
					options={SEVERITIES.map((sv) => ({
						id: sv,
						name: SEVERITY_WORD[sv],
						mark: <SeverityIcon severity={sv} />,
						testId: `severity-${sv}`,
					}))}
					testId="composer-severity"
				/>
			)}
			{search.note && incident && (
				<span
					className="px-1 text-meta text-text-3"
					data-testid="composer-note"
				>
					Note only
				</span>
			)}
		</div>
	);

	return (
		<div
			className="mx-auto flex w-full max-w-[680px] flex-col gap-3 px-4 pt-[18vh] pb-12"
			data-testid="home"
		>
			<h2 className="text-center text-display text-text-1">
				What should we work on?
			</h2>
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

function SeverityIcon({ severity }: { severity: Severity }) {
	const look = markLook("severity", severity);
	return (
		<look.icon
			aria-hidden
			className={cn("size-3.5 shrink-0 stroke-[1.75]", look.className)}
		/>
	);
}

/** The subject chip: the kit picker of projects and services, searchable past nine rows. */
function SubjectPicker({
	value,
	projects,
	services,
	onPick,
}: {
	value: string;
	projects: { id: string; name: string }[];
	services: { id: string; name: string }[];
	onPick: (value: string) => void;
}) {
	const navigate = useNavigate();
	// Read when the menu renders, so a send in this tab shows up next time.
	const menu = subjectMenu(projects, services, lastSubject());
	const kindIcon = (v: string) =>
		v.startsWith("project:") ? FolderGit2 : Boxes;
	const options: PickerOption[] = [
		...(menu.first
			? [
					{
						id: menu.first.value,
						name: menu.first.name,
						icon: kindIcon(menu.first.value),
						testId: "subject-last",
					},
				]
			: []),
		{
			id: "none",
			name: "No project",
			icon: MessageSquare,
			testId: "subject-none",
		},
		...menu.projects.map((p) => ({
			id: `project:${p.id}`,
			name: p.name,
			icon: FolderGit2,
			group: "Projects",
			testId: `subject-project-${p.id}`,
		})),
		...menu.services.map((s) => ({
			id: `service:${s.id}`,
			name: s.name,
			icon: Boxes,
			group: "Services",
			testId: `subject-service-${s.id}`,
		})),
	];
	return (
		<Picker
			label="Subject"
			side="bottom"
			value={value}
			onChange={onPick}
			options={options}
			actions={[
				{
					id: "add-project",
					name: "Add project",
					icon: Plus,
					run: () => void navigate({ to: "/projects", search: { add: true } }),
				},
				{
					id: "add-service",
					name: "Add a service",
					icon: Plus,
					run: () => void navigate({ to: "/services", search: { add: "1" } }),
				},
			]}
			testId="composer-subject"
		/>
	);
}

/** Ready once the agent answered a check; installed but silent needs a sign-in or a fix. */
export function agentReadiness(
	h: { installed: boolean; checked?: { outcome: string } | null } | undefined,
): "ready" | "signIn" | "missing" {
	if (!h?.installed) return "missing";
	return h.checked?.outcome === "answers-acp" ? "ready" : "signIn";
}

/** The default agent's logo with its readiness dot; not ready opens Settings, Agent. */
export function AgentReady() {
	const choice = useAgentChoice();
	if (choice.isLoading) return null;
	const h = choice.effective;
	const state = agentReadiness(h);
	const word = !h
		? "No agent installed"
		: state === "ready"
			? `${h.label} ready`
			: state === "missing"
				? `${h.label} not installed`
				: (unreadyReason(h) ?? `${h.label} not checked`);
	return <AgentReadyChip agent={h?.id ?? null} state={state} word={word} />;
}

/** The chip alone, so the gallery can show each state from fixtures. */
export function AgentReadyChip({
	agent,
	state,
	word,
}: {
	agent: string | null;
	state: "ready" | "signIn" | "missing";
	word: string;
}) {
	const look = markLook("agentReady", state);
	const label = `${look.label}: ${word}`;
	const mark = (
		<span className="relative flex">
			{agent ? (
				<AgentMark id={agent} className="size-4" />
			) : (
				<Bot aria-hidden className="size-4 text-text-3" />
			)}
			<span className="absolute -right-1 -bottom-1 flex rounded-full bg-surface-1 p-px">
				<look.icon
					aria-hidden
					className={cn("size-2.5 stroke-[2.5]", look.className)}
				/>
			</span>
		</span>
	);
	return (
		<Hint label={word}>
			{state === "ready" ? (
				<span
					role="img"
					aria-label={label}
					className={cn(CHIP, "px-2 hover:bg-transparent")}
					data-testid="composer-agent-ready"
					data-state={state}
				>
					{mark}
				</span>
			) : (
				<Link
					to="/settings"
					search={{ tab: "agent" }}
					aria-label={label}
					className={cn(CHIP, "px-2")}
					data-testid="composer-agent-ready"
					data-state={state}
				>
					{mark}
				</Link>
			)}
		</Hint>
	);
}
