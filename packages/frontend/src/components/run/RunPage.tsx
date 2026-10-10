// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import {
	ACCESS_LEVEL_LABEL,
	ACCESS_LEVEL_LINE,
	fidelityAccess,
	type InvestigationWithRelations,
	isRunStateLive,
	modelSubstituted,
	type RunState,
} from "@prismalens/contracts";
import { useLocation, useSearch } from "@tanstack/react-router";
import { PanelRight } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { modelName, useAgentChoice } from "@/components/agent/AgentPicker";
import {
	type IncidentRecord,
	useIncidentRecord,
} from "@/components/incidents/record-context";
import {
	runEffort,
	runElapsed,
	runTimed,
	turnElapsed,
	useRunAgentModel,
} from "@/components/incidents/run-facts";
import { DockedComposer } from "@/components/investigation/DockedComposer";
import { Transcript } from "@/components/investigation/Transcript";
import { Hint } from "@/components/shared/Hint";
import { Loading, Problem } from "@/components/shared/State";
import { useNow } from "@/hooks/use-now";
import { levelSandbox, sandboxLine } from "@/lib/access-levels";
import { failureSentence } from "@/lib/failure-sentence";
import { formatElapsed } from "@/lib/format-time";
import { deriveTranscript, runStepText } from "@/lib/investigation-events";
import { cn } from "@/lib/utils";
import { IncidentHeader } from "./IncidentHeader";
import { type DetailsTab, RunDetailsPanel } from "./RunDetailsPanel";
import { RunStrip, type StripChip } from "./RunStrip";
import {
	contextSections,
	evidenceSections,
	type SummaryFacts,
	summarySections,
} from "./run-details";
import {
	codeChip,
	dayClock,
	runOutcome,
	startedBy,
	startedWhy,
	viewName,
} from "./run-labels";
import {
	deriveSteps,
	flaggedSteps,
	stepFromHash,
	stepOfCall,
} from "./run-steps";

const HIGHLIGHT_MS = 2400;
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * A run's page or an Ask's (#811): the breadcrumb header, the run strip,
 * the transcript pane with the box under it, and the Run details panel
 * beside them. A new conversation is the same page with the box centred.
 */
export function RunPage() {
	const record = useIncidentRecord();
	const { incident, run, runs, draft } = record;
	const now = useNow(1000);
	const search = useSearch({
		from: "/_authenticated/incidents/$id/conversation",
	});
	const { hash } = useLocation();
	const { harnesses } = useAgentChoice();
	const inv = run.investigation;
	const live = !!run.state && isRunStateLive(run.state);
	const chat = inv?.kind === "chat";
	const name = inv ? viewName(runs, inv) : "Run";
	const who = useRunAgentModel(inv);
	const harness = harnesses.find(
		(h) => h.id === (inv?.report?.fidelity?.harness ?? inv?.harness),
	);
	const cwd = inv?.workspace?.cwd;

	const items = useMemo(
		() =>
			deriveTranscript(run.events, now ?? Date.now(), {
				pending: run.pending,
				run: inv
					? {
							id: inv.id,
							status: inv.status,
							live,
							stopRequested: run.stopRequested,
							error: inv.error,
							startedAt: inv.startedAt,
							completedAt: inv.completedAt,
							kind: inv.kind,
							hasReport: !!inv.report,
							continuable: run.continuable,
							lastTurnOutcome: inv.lastTurnOutcome,
							accessLevel: inv.report?.fidelity?.access ?? inv.accessLevel,
						}
					: undefined,
			}),
		[
			run.events,
			now,
			run.pending,
			run.stopRequested,
			run.continuable,
			inv,
			live,
		],
	);
	const steps = useMemo(
		() => deriveSteps(run.events, { cwd, ended: !live }),
		[run.events, cwd, live],
	);
	const byCall = useMemo(() => stepOfCall(steps), [steps]);
	const flaggedAt = useMemo(
		() => flaggedSteps(steps, inv?.report?.flaggedContent),
		[steps, inv?.report?.flaggedContent],
	);
	const flaggedCount = inv?.report?.flaggedContent?.length ?? 0;

	const [panel, setPanel] = useState(false);
	const [tab, setTab] = useState<DetailsTab>("summary");
	const [open, setOpen] = useState<Set<number>>(() => new Set());
	const [highlight, setHighlight] = useState<number | null>(null);
	const toggleRef = useRef<HTMLButtonElement>(null);
	const timer = useRef<number | undefined>(undefined);

	const jump = useCallback((n: number) => {
		setOpen((o) => new Set(o).add(n));
		setHighlight(n);
		window.clearTimeout(timer.current);
		timer.current = window.setTimeout(() => setHighlight(null), HIGHLIGHT_MS);
		window.setTimeout(() => {
			document
				.getElementById(`step-${n}`)
				?.scrollIntoView({ block: "center", behavior: "smooth" });
		}, 60);
	}, []);
	useEffect(() => () => window.clearTimeout(timer.current), []);

	// `#step-N` and a report's `?call=` open and ring their step once it has arrived.
	const wanted =
		stepFromHash(hash) ??
		(search.call ? (byCall.get(search.call) ?? null) : null);
	const jumped = useRef<string | null>(null);
	useEffect(() => {
		const key = `${inv?.id}:${wanted}`;
		if (wanted === null || jumped.current === key) return;
		if (!steps.some((s) => s.n === wanted)) return;
		jumped.current = key;
		jump(wanted);
	}, [wanted, steps, inv?.id, jump]);

	const closePanel = useCallback(() => {
		setPanel(false);
		window.setTimeout(() => toggleRef.current?.focus(), 0);
	}, []);
	useEffect(() => {
		if (!panel) return;
		// Capture: Esc closes the panel before anything bound to Esc on the page goes Back.
		const onKey = (e: KeyboardEvent) => {
			if (e.key !== "Escape" || e.defaultPrevented) return;
			const t = e.target as HTMLElement | null;
			if (t?.closest("[role=menu],[role=dialog],[role=listbox],textarea"))
				return;
			e.preventDefault();
			closePanel();
		};
		window.addEventListener("keydown", onKey, true);
		return () => window.removeEventListener("keydown", onKey, true);
	}, [panel, closePanel]);
	const seeFlag = useCallback(() => {
		setTab("context");
		setPanel(true);
	}, []);

	const report = inv?.report;
	const header = (
		<IncidentHeader
			incident={incident}
			view={draft ? "New conversation" : inv ? name : "Run"}
			reportRunId={report ? inv?.id : null}
			onResolve={record.openClose}
			onReopen={record.openReopen}
			onEditCause={record.openEditCause}
			controlsSpace={!panel}
			trailing={
				inv && !draft ? (
					<DetailsToggle
						ref={toggleRef}
						open={panel}
						onToggle={() => (panel ? closePanel() : setPanel(true))}
						title={chat ? "Question details" : "Run details"}
						flagged={flaggedCount}
					/>
				) : null
			}
		/>
	);

	if (draft) return <DraftPage record={record} header={header} />;

	const step = runStepText(run.events, now ?? Date.now(), {
		streamLost: run.streamFailed,
	});
	const stateWord = stripWords(
		inv,
		run.state,
		run.latestText ?? (step ? cap(step.text) : null),
		name,
		now,
		who.agent,
	);
	const fidelity = report?.fidelity;
	const substituted = !!fidelity && modelSubstituted(fidelity);
	const asked = fidelity?.model ? modelName(harness, fidelity.model) : null;
	const version = fidelity?.harnessVersion ? ` ${fidelity.harnessVersion}` : "";
	const modelChip: StripChip | null = inv
		? {
				text: substituted ? `${who.model}, asked ${asked}` : cap(who.model),
				title: substituted
					? `${who.agent}${version}. You asked for ${asked}; the agent reported ${who.model}.`
					: `${who.agent}${version} running ${who.model}.`,
				warn: substituted,
			}
		: null;
	const code = codeChip(inv?.workspace);

	const transcriptReport =
		report && inv && !chat
			? {
					title: `${name} concluded: ${runOutcome({ ...inv, hasReport: true })}`,
					summary: report.summary,
				}
			: null;

	return (
		<div className="flex h-full min-h-0" data-testid="run-page">
			<div className="flex min-w-0 flex-1 flex-col">
				{header}
				<RunStrip
					state={run.state}
					label={stateWord.label}
					detail={stateWord.detail}
					model={modelChip}
					code={panel ? null : code}
					onStop={
						live ? () => run.stop({ onError: () => undefined }) : undefined
					}
					stopping={run.stopRequested}
					incidentId={incident.id}
					runs={runs}
					current={inv?.id ?? null}
				/>
				<div className="min-h-0 flex-1">
					{run.isLoading ? (
						<div className="mx-auto max-w-[760px] px-4 pt-5">
							<Loading rows={5} />
						</div>
					) : run.error || !inv ? (
						<div className="mx-auto max-w-[760px] px-4 pt-5">
							<Problem text="This run did not load." />
						</div>
					) : (
						<Transcript
							items={items}
							incidentId={incident.id}
							runId={inv.id}
							cwd={cwd}
							agent={who.agent}
							runName={name}
							briefBy={
								startedBy(inv.triggerType) === "you" ? "You" : "PrismaLens"
							}
							report={transcriptReport}
							steps={{
								all: steps,
								open,
								onToggle: (n) =>
									setOpen((o) => {
										const next = new Set(o);
										if (!next.delete(n)) next.add(n);
										return next;
									}),
								highlight,
								flagged: new Set(flaggedAt.values()),
								onSeeFlag: seeFlag,
							}}
						/>
					)}
				</div>
				{/* Not while the run loads: the key turns from "none" to its id and the remount drops typed text (#807). */}
				{!run.isLoading && <DockedComposer key={inv?.id ?? "none"} />}
			</div>
			{panel && inv && (
				<RunDetailsPanel
					title={chat ? "Question details" : `${name} details`}
					tab={tab}
					onTab={setTab}
					onClose={closePanel}
					incidentId={incident.id}
					summary={summarySections(
						inv,
						summaryFacts(inv, run, {
							now,
							agent: harness ? `${harness.label}${version}` : who.agent,
							model: modelChip,
							asked,
							harness,
						}),
					)}
					evidence={evidenceSections(inv, byCall, {
						live,
						standing: standingRun(record, inv.id),
					})}
					context={contextSections({
						report,
						flaggedStep: flaggedAt,
						items,
						briefBy:
							startedBy(inv.triggerType) === "you"
								? "you"
								: `PrismaLens when it started ${name}`,
						alert: primaryAlert(incident, now),
					})}
					flaggedCount={flaggedCount}
					steps={steps}
					onJump={jump}
				/>
			)}
		</div>
	);
}

/** The header's details toggle: a red dot while something is flagged and the panel is shut. */
function DetailsToggle({
	ref,
	open,
	onToggle,
	title,
	flagged,
}: {
	ref: React.Ref<HTMLButtonElement>;
	open: boolean;
	onToggle: () => void;
	title: string;
	flagged: number;
}) {
	const label =
		flagged > 0
			? `${title}, ${flagged} flagged ${flagged === 1 ? "item" : "items"}`
			: title;
	return (
		<Hint label={label}>
			<button
				ref={ref}
				type="button"
				aria-label={label}
				aria-pressed={open}
				aria-controls="run-details"
				onClick={onToggle}
				className={cn(
					"relative flex size-7 shrink-0 items-center justify-center rounded-control transition-colors duration-(--dur-instant) hover:bg-surface-3",
					open ? "bg-surface-3 text-text-1" : "bg-surface-2 text-text-2",
				)}
				data-testid="details-toggle"
			>
				<PanelRight className="size-4" aria-hidden />
				{flagged > 0 && !open && (
					<span
						aria-hidden
						className="absolute top-[3px] right-[3px] size-[7px] rounded-full bg-danger"
						data-testid="details-flag"
					/>
				)}
			</button>
		</Hint>
	);
}

/** The strip's two words: which run and its state, then what it is doing or came to. */
function stripWords(
	inv: InvestigationWithRelations | null,
	state: RunState | null,
	activity: string | null,
	name: string,
	now: number | null,
	agent: string,
): { label: string; detail: string } {
	if (!inv || !state) return { label: name, detail: "" };
	const chat = inv.kind === "chat";
	const who = chat ? "Ask" : name;
	const took = runTimed(inv) ? formatElapsed(runElapsed(inv, now)) : null;
	const when = (at: string | null) =>
		at && now !== null ? relative(at, now) : "";
	switch (state) {
		case "starting":
			return {
				label: `${who} starting`,
				detail: "Gathering what the agent needs",
			};
		case "working":
		case "stopping":
			return {
				label: chat
					? `Ask, ${state === "stopping" ? "stopping" : "answering"}`
					: `${who} ${state === "stopping" ? "stopping" : "investigating"}`,
				detail: activity ?? "Working",
			};
		case "failed":
			return {
				label: chat ? "Ask, failed" : `${who} failed`,
				detail: failureSentence(agent, inv.error).said,
			};
		case "stopped":
			return {
				label: chat ? "Ask, stopped" : `${who} stopped`,
				detail: `Stopped by you ${when(inv.completedAt)}${took ? `, after ${took}` : ""}`,
			};
		default: {
			const ago = when(inv.completedAt ?? inv.updatedAt);
			if (chat)
				return {
					label: "Ask, answered",
					detail: [ago, took && `took ${took}`].filter(Boolean).join(", "),
				};
			const found = inv.report
				? inv.report.rootCause
					? "Likely cause found"
					: "No cause named"
				: "Ended without a report";
			return {
				label: `${who} concluded`,
				detail: [found, ago, took && `took ${took}`].filter(Boolean).join(", "),
			};
		}
	}
}

function relative(at: string, now: number): string {
	const s = Math.max(0, Math.round((now - new Date(at).getTime()) / 1000));
	if (s < 60) return "just now";
	if (s < 3600) return `${Math.floor(s / 60)}m ago`;
	if (s < 86_400) return `${Math.floor(s / 3600)}h ago`;
	return `${Math.floor(s / 86_400)}d ago`;
}

function summaryFacts(
	inv: InvestigationWithRelations,
	run: IncidentRecord["run"],
	ctx: {
		now: number | null;
		agent: string;
		model: StripChip | null;
		asked: string | null;
		harness: Parameters<typeof levelSandbox>[0];
	},
): SummaryFacts {
	const state = run.state;
	const chat = inv.kind === "chat";
	const live = !!state && isRunStateLive(state);
	const f = inv.report?.fidelity;
	const status: SummaryFacts["status"] =
		state === "failed"
			? {
					text: "Failed",
					tone: "danger",
					sub: failureSentence(ctx.agent, inv.error).said,
				}
			: state === "stopped"
				? { text: "Stopped by you" }
				: live
					? { text: chat ? "Answering" : "Investigating", tone: "live" }
					: chat
						? { text: "Answered", tone: "ok" }
						: {
								text: `Concluded: ${runOutcome({ ...inv, hasReport: !!inv.report })}`,
								tone: "ok",
							};
	const at = inv.startedAt ?? inv.createdAt;
	const why = startedWhy(inv.triggerType);
	const asked = f?.access ?? inv.accessLevel ?? undefined;
	const ran = f ? fidelityAccess(f, inv.agentMode) : asked;
	const level = ran ?? asked;
	const effort = runEffort(inv, run.events) ?? inv.effort ?? null;
	return {
		status,
		started: {
			text: `${dayClock(at, ctx.now)} by ${startedBy(inv.triggerType)}`,
			...(why ? { sub: why } : {}),
		},
		took: runTimed(inv)
			? live
				? {
						label: "Running for",
						text: formatElapsed(turnElapsed(inv, run.events, ctx.now)),
					}
				: { label: "Took", text: formatElapsed(runElapsed(inv, ctx.now)) }
			: null,
		agent: ctx.agent,
		model: ctx.model
			? {
					text: ctx.model.warn
						? (ctx.model.text.split(",")[0] ?? "")
						: ctx.model.text,
					warn: !!ctx.model.warn,
					...(ctx.model.warn
						? {
								sub: `You asked for ${ctx.asked}; the agent reported ${ctx.model.text.split(",")[0]}. A running agent cannot switch models; investigate again to use ${ctx.asked}.`,
							}
						: {}),
				}
			: null,
		effort: effort ? cap(effort) : null,
		access: level
			? {
					text: ACCESS_LEVEL_LABEL[level],
					sub: [
						asked && ran && asked !== ran
							? `Asked for ${ACCESS_LEVEL_LABEL[asked]}; the agent ran ${ACCESS_LEVEL_LABEL[ran]}.`
							: ACCESS_LEVEL_LINE[level],
						sandboxLine(levelSandbox(ctx.harness, level)),
					].join(" "),
				}
			: null,
		chat,
	};
}

/** The newest other run with a report: its finding stands while this one has none. */
function standingRun(
	record: IncidentRecord,
	self: string,
): { runId: string; name: string } | null {
	const r = record.runs.find((x) => x.id !== self && x.hasReport);
	return r ? { runId: r.id, name: viewName(record.runs, r) } : null;
}

function primaryAlert(
	incident: IncidentRecord["incident"],
	now: number | null,
): {
	title: string;
	labels: Record<string, string> | null;
	fired: string;
} | null {
	const a = incident.alerts?.[0];
	if (!a) return null;
	return {
		title: a.title,
		labels: a.labels,
		fired: dayClock(a.triggeredAt, now),
	};
}

/**
 * A new conversation (#811): the box centred with what the agent already
 * knows above it; the first send starts the run and the page becomes its own.
 */
function DraftPage({
	record,
	header,
}: {
	record: IncidentRecord;
	header: React.ReactNode;
}) {
	const known = record.runs.find((r) => r.hasReport && r.rootCause);
	return (
		<div className="flex h-full min-h-0" data-testid="run-page" data-draft="">
			<div className="flex min-w-0 flex-1 flex-col">
				{header}
				<RunStrip
					state={null}
					label="New conversation"
					detail="Nothing sent yet"
					incidentId={record.incident.id}
					runs={record.runs}
					current="new"
				/>
				<div className="flex min-h-0 flex-1 flex-col justify-center px-4 pb-[12vh]">
					<div className="mx-auto flex w-full max-w-[760px] flex-col gap-3">
						<div className="flex flex-col gap-1 px-1" data-testid="draft-known">
							<span className="text-meta text-text-3">
								Asking about INC-{record.incident.number}.
								{known ? " The agent already knows this:" : ""}
							</span>
							{known && (
								<span className="text-text-2">
									Likely cause from {viewName(record.runs, known)}:{" "}
									{known.rootCause}
								</span>
							)}
						</div>
						<DockedComposer key="draft" floating />
					</div>
				</div>
			</div>
		</div>
	);
}
