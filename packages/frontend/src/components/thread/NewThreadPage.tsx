// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { Severity, ThreadStartSubject } from "@prismalens/contracts";
import { useNavigate } from "@tanstack/react-router";
import { Siren, SquarePen } from "lucide-react";
import { usePageTitle } from "@/hooks/use-page-title";
import { useRepositories, useServices } from "@/lib/api/hooks";
import { cn } from "@/lib/utils";
import { NewThread } from "./NewThread";

export interface NewThreadSearch {
	project?: string;
	service?: string;
	incident?: boolean;
	severity?: Severity;
	note?: boolean;
}

const SEVERITIES: Severity[] = ["critical", "high", "medium", "low"];
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
	const services = useServices();
	const set = (next: Partial<NewThreadSearch>) =>
		void navigate({
			to: "/threads/new",
			search: (prev: NewThreadSearch) => ({ ...prev, ...next }),
			replace: true,
		});
	const subject = subjectOf(search);
	const incident = search.incident ? (search.severity ?? "high") : null;
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
			<select
				aria-label="Subject"
				value={value}
				onChange={(e) => {
					const [kind, id] = e.target.value.split(":");
					set({
						project: kind === "project" ? id : undefined,
						service: kind === "service" ? id : undefined,
					});
				}}
				className="h-7 max-w-64 truncate rounded-control bg-surface-2 px-2 text-meta text-text-1"
				data-testid="composer-subject"
			>
				<option value="none">No project</option>
				{(repos.data?.data ?? []).length > 0 && (
					<optgroup label="Projects">
						{repos.data?.data.map((r) => (
							<option key={r.id} value={`project:${r.id}`}>
								{r.fullName}
							</option>
						))}
					</optgroup>
				)}
				{(services.data?.data ?? []).length > 0 && (
					<optgroup label="Services">
						{services.data?.data.map((s) => (
							<option key={s.id} value={`service:${s.id}`}>
								{s.displayName || s.name}
							</option>
						))}
					</optgroup>
				)}
			</select>
			<button
				type="button"
				aria-pressed={!!search.incident}
				onClick={() =>
					set({ incident: search.incident ? undefined : true, note: undefined })
				}
				className={cn(
					"inline-flex h-7 items-center gap-1.5 rounded-control px-2 text-meta transition-colors duration-(--dur-instant)",
					search.incident
						? "bg-surface-3 font-medium text-text-1"
						: "bg-surface-2 text-text-2 hover:text-text-1",
				)}
				data-testid="composer-incident"
			>
				<Siren aria-hidden className="size-3.5" />
				Incident
			</button>
			{incident && (
				<select
					aria-label="Severity"
					value={incident}
					onChange={(e) => set({ severity: e.target.value as Severity })}
					className="h-7 rounded-control bg-surface-2 px-2 text-meta text-text-1"
					data-testid="composer-severity"
				>
					{SEVERITIES.map((s) => (
						<option key={s} value={s}>
							{SEVERITY_WORD[s]}
						</option>
					))}
				</select>
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
			<header className="flex min-h-(--header-h) shrink-0 items-center gap-2 bg-surface-1 py-1.5 pr-3 pl-4">
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
						slash={[
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
						]}
					/>
				</div>
			</div>
		</div>
	);
}
