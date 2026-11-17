// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { ThreadContext } from "@prismalens/contracts";
import { Link } from "@tanstack/react-router";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { type ReactNode, useState } from "react";
import { fact } from "@/components/kit/fact";
import { Mark } from "@/components/kit/Mark";
import { Hint } from "@/components/shared/Hint";
import { Ring } from "@/components/shared/Ring";
import { Empty, Loading } from "@/components/shared/State";
import { RunInTerminal } from "@/components/terminal/RunInTerminal";
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button, buttonVariants } from "@/components/ui/button";
import { toast } from "@/hooks/use-toast";
import { useEditProjectScript } from "@/lib/api/hooks/use-project-scripts";
import { getErrorMessage } from "@/lib/get-error-message";
import { lazyPart } from "@/lib/lazy";
import { statusWord } from "@/lib/spine";
import { severityWord } from "@/lib/thread-rows";
import { cn } from "@/lib/utils";
import { PanelSection } from "./ThreadSections";

type Of<K extends ThreadContext["kind"]> = Extract<ThreadContext, { kind: K }>;

const when = new Intl.DateTimeFormat(undefined, {
	month: "short",
	day: "numeric",
	hour: "numeric",
	minute: "2-digit",
});

/** A schedule's recurrence in one line. */
export function recurrenceLine(
	r: Of<"schedule">["schedule"]["recurrence"],
): string {
	if (!r) return "Runs only when started";
	if (r.type === "cron") return `${r.expr} (${r.timezone})`;
	const m = r.everyMinutes;
	if (m % 1440 === 0)
		return m === 1440 ? "Every day" : `Every ${m / 1440} days`;
	if (m % 60 === 0) return m === 60 ? "Every hour" : `Every ${m / 60} hours`;
	return `Every ${m} minutes`;
}

const RUN_WORD: Record<string, string> = {
	running: "Running",
	pending: "Queued",
	completed: "Completed",
	failed: "Failed",
};

function Rows({ children }: { children: ReactNode }) {
	return (
		<dl className="m-0 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 px-2 text-meta">
			{children}
		</dl>
	);
}

function Row({ term, children }: { term: string; children: ReactNode }) {
	return (
		<>
			<dt className="text-text-3">{term}</dt>
			<dd className="m-0 min-w-0 text-text-1">{children}</dd>
		</>
	);
}

/**
 * The tab named for the thread's subject (#1024): Incident, Runs, Service or Project.
 * An incident page passes its own richer body (`incident`); the context fills the rest.
 */
export function KindTab({
	context,
	incident,
}: {
	context: ThreadContext;
	/** The incident page's own sections: impact, runbooks, brief, delivery, labels, flagged content. */
	incident?: ReactNode;
}) {
	switch (context.kind) {
		case "incident":
			return incident ? (
				<div data-testid="kind-tab-incident">{incident}</div>
			) : (
				<IncidentKind context={context} />
			);
		case "schedule":
			return <RunsKind context={context} />;
		case "service":
			return <ServiceKind context={context} />;
		case "project":
			return <ProjectKind context={context} />;
		case "none":
			return null;
	}
}

function IncidentKind({ context }: { context: Of<"incident"> }) {
	const { incident, suspects, report } = context;
	return (
		<div className="flex flex-col gap-4" data-testid="kind-tab-incident">
			<PanelSection id="incident" title="Incident">
				<Rows>
					<Row term="Incident">
						<Link
							to="/incidents/$id"
							params={{ id: incident.id }}
							className="hover:underline"
						>
							INC-{incident.number} {incident.title}
						</Link>
					</Row>
					<Row term="Severity">
						<Mark
							id="severity"
							state={incident.severity}
							word={severityWord(incident.severity)}
							className="align-middle"
							testId="kind-severity"
						/>
					</Row>
					<Row term="Status">{incident.status}</Row>
					<Row term="Alerts">{incident.alertCount}</Row>
					{incident.impact && <Row term="Impact">{incident.impact}</Row>}
				</Rows>
			</PanelSection>
			{suspects.length > 0 && (
				<PanelSection id="suspects" title="Suspects">
					<ol className="m-0 flex list-none flex-col gap-1 p-0 px-2">
						{suspects.map((h) => (
							<li key={h.id} className="flex flex-col" data-testid="suspect">
								<span
									className={cn(
										"text-meta",
										h.status === "refuted" ? "text-text-3" : "text-accent",
									)}
									{...fact("cause")}
								>
									{statusWord(h.status)}
								</span>
								<span className="text-text-1">{h.statement}</span>
							</li>
						))}
					</ol>
				</PanelSection>
			)}
			{report !== "none" && (
				<PanelSection id="report" title="Report">
					<p className="m-0 px-2 text-meta text-text-1">
						{report === "ready"
							? "Report ready"
							: report === "running"
								? "Writing the report"
								: "The report failed"}
					</p>
				</PanelSection>
			)}
		</div>
	);
}

function RunsKind({ context }: { context: Of<"schedule"> }) {
	const { schedule } = context;
	return (
		<div className="flex flex-col gap-4" data-testid="kind-tab-schedule">
			<PanelSection id="schedule" title={schedule.name}>
				<Rows>
					<Row term="Repeats">{recurrenceLine(schedule.recurrence)}</Row>
					<Row term="Next run">
						{schedule.nextRunAt
							? when.format(new Date(schedule.nextRunAt))
							: "None planned"}
					</Row>
				</Rows>
			</PanelSection>
			{schedule.lastRuns.length > 0 && (
				<PanelSection id="last-runs" title="Last runs">
					<ul className="m-0 flex list-none flex-col p-0">
						{schedule.lastRuns.map((r) => (
							<li key={r.id}>
								<Link
									to="/threads/$id"
									params={{ id: r.id }}
									className="flex items-center gap-2 rounded-control px-2 py-1 text-meta hover:bg-surface-3"
								>
									<Mark
										id="run"
										state={r.status}
										word={RUN_WORD[r.status] ?? r.status}
										glyph={r.status === "running" ? <Ring /> : undefined}
									/>
									<span className="flex-1 text-text-1">
										{when.format(new Date(r.at))}
									</span>
								</Link>
							</li>
						))}
					</ul>
				</PanelSection>
			)}
		</div>
	);
}

function ServiceKind({ context }: { context: Of<"service"> }) {
	const { service } = context;
	return (
		<div className="flex flex-col gap-4" data-testid="kind-tab-service">
			<PanelSection id="service" title={service.name}>
				<Rows>
					<Row term="Tier">{service.tier}</Row>
					<Row term="Owner">{service.owner ?? "No owner"}</Row>
				</Rows>
			</PanelSection>
			{service.dependencies.length > 0 && (
				<PanelSection id="dependencies" title="Depends on">
					<ul className="m-0 flex list-none flex-col p-0">
						{service.dependencies.map((d) => (
							<li key={d.id}>
								<Link
									to="/services/$id"
									params={{ id: d.id }}
									className="block rounded-control px-2 py-1 text-meta text-text-1 hover:bg-surface-3"
								>
									{d.name}
								</Link>
							</li>
						))}
					</ul>
				</PanelSection>
			)}
		</div>
	);
}

const ScriptDialog = lazyPart(
	() => import("./ScriptDialog").then((m) => m.ScriptDialog),
	<Loading rows={2} />,
);

type Stored = { id: string; name: string; command: string };

function IconButton({
	label,
	onClick,
	testId,
	children,
}: {
	label: string;
	onClick: () => void;
	testId: string;
	children: ReactNode;
}) {
	return (
		<Hint label={label}>
			<button
				type="button"
				aria-label={label}
				onClick={onClick}
				className="flex size-6 shrink-0 items-center justify-center rounded-control text-text-3 hover:bg-surface-3 hover:text-text-1"
				data-testid={testId}
			>
				{children}
			</button>
		</Hint>
	);
}

function ProjectKind({ context }: { context: Of<"project"> }) {
	const { project, scripts } = context;
	const owner = !!context.machine.isOwner;
	const [dialog, setDialog] = useState<{ script?: Stored } | null>(null);
	const [removing, setRemoving] = useState<Stored | null>(null);
	const edit = useEditProjectScript(project.id);
	return (
		<div className="flex flex-col gap-4" data-testid="kind-tab-project">
			<PanelSection id="project" title={project.name}>
				<p className="m-0 px-2 text-meta">
					<Link
						to="/projects/$id"
						params={{ id: project.id }}
						className="text-accent hover:underline"
					>
						Open the project
					</Link>
				</p>
			</PanelSection>
			<PanelSection
				id="scripts"
				title="Scripts"
				aside={
					owner && (
						<Button
							variant="text"
							size="xs"
							onClick={() => setDialog({})}
							data-testid="script-add"
						>
							<Plus aria-hidden className="size-3" />
							Add script
						</Button>
					)
				}
			>
				{scripts.length === 0 ? (
					<Empty text="No scripts yet" className="px-2" />
				) : (
					<ul className="m-0 flex list-none flex-col gap-0.5 p-0 px-2">
						{scripts.map((s) => {
							const stored = s.id
								? { id: s.id, name: s.name, command: s.command }
								: null;
							return (
								<li
									key={s.id ?? `${s.runner}:${s.name}`}
									className="flex min-w-0 items-center gap-1 text-meta"
									data-testid="script-row"
									data-runner={s.runner}
								>
									<Hint label={s.name}>
										<code className="min-w-0 flex-1 truncate font-mono text-mono text-text-1">
											{s.command}
										</code>
									</Hint>
									<RunInTerminal command={s.command} compact />
									{owner && stored && (
										<>
											<IconButton
												label={`Edit ${s.name}`}
												onClick={() => setDialog({ script: stored })}
												testId="script-edit"
											>
												<Pencil aria-hidden className="size-3.5" />
											</IconButton>
											<IconButton
												label={`Remove ${s.name}`}
												onClick={() => setRemoving(stored)}
												testId="script-remove-open"
											>
												<Trash2 aria-hidden className="size-3.5" />
											</IconButton>
										</>
									)}
								</li>
							);
						})}
					</ul>
				)}
			</PanelSection>
			{dialog && (
				<ScriptDialog
					projectId={project.id}
					{...(dialog.script ? { script: dialog.script } : {})}
					onClose={() => setDialog(null)}
				/>
			)}
			<AlertDialog
				open={!!removing}
				onOpenChange={(o) => !o && setRemoving(null)}
			>
				<AlertDialogContent data-testid="script-remove-confirm">
					<AlertDialogHeader>
						<AlertDialogTitle>Remove {removing?.name}?</AlertDialogTitle>
						<AlertDialogDescription>
							The project stops listing it. Nothing else changes.
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel>Cancel</AlertDialogCancel>
						<AlertDialogAction
							className={buttonVariants({ variant: "danger-fill" })}
							onClick={() =>
								removing &&
								edit.mutate(
									{ op: "remove", scriptId: removing.id },
									{
										onError: (e) =>
											toast({
												title: "Script not removed",
												description: getErrorMessage(e),
												variant: "destructive",
											}),
									},
								)
							}
							data-testid="script-remove"
						>
							Remove
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</div>
	);
}
