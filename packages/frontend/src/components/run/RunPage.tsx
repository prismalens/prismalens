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
import {
	useLocation,
	useNavigate,
	useRouter,
	useSearch,
} from "@tanstack/react-router";
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
import {
	DockedComposer,
	stopFailed,
	useRecheck,
} from "@/components/investigation/DockedComposer";
import { Transcript } from "@/components/investigation/Transcript";
import { Hint } from "@/components/shared/Hint";
import { Loading, Problem } from "@/components/shared/State";
import { RightPanel } from "@/components/shell/PanelShell";
import { useLayoutPrefs } from "@/hooks/use-layout-prefs";
import { PHONE, useMediaQuery } from "@/hooks/use-media-query";
import { useNow } from "@/hooks/use-now";
import { useToast } from "@/hooks/use-toast";
import { levelSandbox, sandboxLine } from "@/lib/access-levels";
import {
	citedFile,
	codeHostUrl,
	type FileAt,
	readsOf,
	stepFile,
} from "@/lib/evidence-files";
import { failureStatusLine } from "@/lib/failure-sentence";
import { formatElapsed } from "@/lib/format-time";
import { getErrorMessage } from "@/lib/get-error-message";
import { handedOff } from "@/lib/handoff-line";
import {
	deriveTranscript,
	runStepText,
	shareItems,
	type TranscriptItem,
} from "@/lib/investigation-events";
import { useRenderProbe } from "@/lib/render-probe";
import { askTitle } from "@/lib/run-asks";
import { runLinks } from "@/lib/run-links";
import { fileFromParam, fileParam, touchedFiles } from "@/lib/run-panel";
import { cn } from "@/lib/utils";
import {
	type CiteTarget,
	HYPOTHESES_OPEN_ID,
	HypothesesCard,
	useFocusLater,
} from "./HypothesesCard";
import { IncidentHeader } from "./IncidentHeader";
import { KeptWorkspaces } from "./KeptWorkspaces";
import { snapshotLine } from "./PreRunCoverage";
import {
	type DetailsTab,
	overviewSteps,
	RunDetailsPanel,
	RunOverview,
	RunToolsSection,
} from "./RunDetailsPanel";
import { RunRunbooks } from "./RunRunbooks";
import { RunStrip, type StripChip } from "./RunStrip";
import { codeLine, runsFolder, toolsStatus, toolTurns } from "./RunTools";
import {
	contextSections,
	evidenceSections,
	type SummaryFacts,
	summarySections,
} from "./run-details";
import {
	codeChip,
	dayClock,
	reportOutcome,
	runOutcome,
	startedBy,
	startedWhy,
	viewName,
} from "./run-labels";
import {
	evidenceStep,
	flaggedSteps,
	type RunStep,
	stepFromHash,
	stepOfCall,
} from "./run-steps";
import { usageView } from "./run-usage";

const HIGHLIGHT_MS = 2400;
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * A run's page or an Ask's (#811): the breadcrumb header, the run strip,
 * the transcript pane with the box under it, and the Run details panel
 * beside them. A new conversation is the same page with the box centred.
 */
export function RunPage() {
	const record = useIncidentRecord();
	const { toast } = useToast();
	const { incident, run, runs, draft } = record;
	const search = useSearch({
		from: "/_authenticated/incidents/$id/conversation",
	});
	const { hash } = useLocation();
	const { harnesses } = useAgentChoice();
	const inv = run.investigation;
	const live = !!run.state && isRunStateLive(run.state);
	// The transcript's own counter has its clock; the strip and panel need a second only while live.
	const now = useNow(live ? 1000 : 30_000);
	useRenderProbe("RunPage", { now, run });
	const chat = inv?.kind === "chat";
	const name = inv ? viewName(runs, inv) : "Run";
	const who = useRunAgentModel(inv);
	const harness = harnesses.find((h) => h.id === who.id);
	const cwd = inv?.workspace?.cwd;

	const shared = useRef<TranscriptItem[]>([]);
	const derived = useMemo(
		() =>
			deriveTranscript(run.events, {
				pending: run.pending,
				modelName: (id) => modelName(harness, id) ?? id,
				agentName: (id) => harnesses.find((h) => h.id === id)?.label ?? id,
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
			run.pending,
			run.stopRequested,
			run.continuable,
			inv,
			live,
			harness,
			harnesses,
		],
	);
	const items = useMemo(() => shareItems(shared.current, derived), [derived]);
	useEffect(() => {
		shared.current = items;
	}, [items]);
	const steps = run.steps;
	const byCall = useMemo(() => stepOfCall(steps), [steps]);
	const flaggedAt = useMemo(
		() => flaggedSteps(steps, inv?.report?.flaggedContent),
		[steps, inv?.report?.flaggedContent],
	);
	const flaggedCount = inv?.report?.flaggedContent?.length ?? 0;

	const { rightPanel, setRightPanel } = useLayoutPrefs();
	const [sheetOpen, setSheetOpen] = useState(false);
	const [remembered, setRemembered] = useState<DetailsTab>("summary");
	const [open, setOpen] = useState<Set<number>>(() => new Set());
	const [highlight, setHighlight] = useState<number | null>(null);
	const toggleRef = useRef<HTMLButtonElement>(null);
	const timer = useRef<number | undefined>(undefined);
	const [workOpen, setWorkOpen] = useState(false);
	const [preview, setPreview] = useState(false);
	const phone = useMediaQuery(PHONE);
	const panel = phone ? sheetOpen : rightPanel;
	// Crossing the phone breakpoint carries the panel's state over (#974 OBJ-012).
	const wasPhone = useRef(phone);
	useEffect(() => {
		if (wasPhone.current === phone) return;
		const open = wasPhone.current ? sheetOpen : rightPanel;
		wasPhone.current = phone;
		if (phone) setSheetOpen(open);
		else setRightPanel(open);
		// biome-ignore lint/correctness/useExhaustiveDependencies: only a breakpoint crossing moves the state.
	}, [phone]);
	const setPanel = useCallback(
		(open: boolean) => (phone ? setSheetOpen : setRightPanel)(open),
		[phone, setRightPanel],
	);
	const focusLater = useFocusLater();
	const workspace = inv?.workspace;
	// The URL holds the open file and the tab (#973 OBJ-008): Back, Forward and reload show what it names.
	const navigate = useNavigate();
	const router = useRouter();
	const viewing = useMemo(
		() =>
			search.file
				? (fileFromParam(search.file, workspace) ??
					citedFile(search.file, workspace))
				: null,
		[search.file, workspace],
	);
	const tab: DetailsTab = search.panel ?? (viewing ? "files" : remembered);
	const setSearch = useCallback(
		(
			patch: { file?: string | undefined; panel?: DetailsTab | undefined },
			replace: boolean,
		) =>
			navigate({
				to: ".",
				search: (prev: Record<string, unknown>) => ({ ...prev, ...patch }),
				replace,
				hash: (h: string | undefined) => h ?? "",
			} as never),
		[navigate],
	);
	const setTab = useCallback(
		(t: DetailsTab) => {
			setRemembered(t);
			setSearch({ panel: t }, true);
		},
		[setSearch],
	);
	// Per file opened: the control that opened it, which Back returns focus to; kept, so Forward then Back finds it again.
	const origins = useRef(
		new Map<string, { id: string; tab: DetailsTab; inPanel: boolean }>(),
	);
	const origin = useRef<{
		id: string;
		tab: DetailsTab;
		inPanel: boolean;
	} | null>(null);
	origin.current = search.file
		? (origins.current.get(search.file) ?? origin.current)
		: origin.current;
	const pushed = useRef<string | null>(null);
	const tabRef = useRef<DetailsTab>(tab);
	tabRef.current = tab;
	// The sheet's "Open the drawing" link, while the drawing it opened is up; Back returns there.
	const previewFrom = useRef<string | null>(null);
	const openFile = useCallback(
		(f: FileAt, opener: string) => {
			const from =
				opener === HYPOTHESES_OPEN_ID && previewFrom.current
					? previewFrom.current
					: opener;
			// Read now: by Back, the control that opened the file may be unmounted.
			const inPanel = !!document
				.getElementById("run-details")
				?.contains(document.getElementById(from));
			const param = fileParam(f);
			origin.current = { id: from, tab: tabRef.current, inPanel };
			origins.current.set(param, origin.current);
			// The entry it leaves keeps its tab, so Back lands where the reader was; none for a phone sheet that closes on Back.
			setSearch(
				{ panel: phone && !inPanel ? undefined : tabRef.current },
				true,
			);
			pushed.current = param;
			setSearch({ file: param, panel: "files" }, false);
			setPanel(true);
			focusLater("evidence-file-back");
		},
		[focusLater, setPanel, setSearch, phone],
	);
	const closeFile = useCallback(() => {
		if (pushed.current && pushed.current === search.file) {
			pushed.current = null;
			router.history.back();
		} else {
			const from = origin.current;
			const lifts = phone && from && !from.inPanel;
			setSearch(
				{ file: undefined, panel: lifts ? undefined : from?.tab },
				true,
			);
		}
	}, [router, search.file, setSearch, phone]);
	// A closed panel names no tab or file, so a reload or a shared link opens it as the reader left it.
	const hidePanel = useCallback(() => {
		// Its focus goes to the panel's toggle, not to what opened the file.
		if (search.file) origins.current.delete(search.file);
		setPanel(false);
		if (search.panel || search.file)
			setSearch({ panel: undefined, file: undefined }, true);
	}, [setPanel, setSearch, search.panel, search.file]);
	// However the file closed (its Back, or the browser's), focus returns to what opened it (#975 OBJ-008).
	const lastFile = useRef(search.file);
	useEffect(() => {
		const closed = lastFile.current && !search.file ? lastFile.current : null;
		lastFile.current = search.file;
		const from = closed ? origins.current.get(closed) : undefined;
		if (!from) return;
		// On a phone the details are a sheet over the page: Back to a control under it lifts the sheet.
		if (phone && !from.inPanel) setPanel(false);
		focusLater(from.id);
	}, [search.file, phone, setPanel, focusLater]);
	const touched = useMemo(
		() =>
			touchedFiles(
				steps,
				workspace,
				(inv?.report?.hypotheses ?? []).flatMap((h) =>
					h.evidence.flatMap((e) => {
						const f = citedFile(e.source, workspace);
						return f ? [f] : [];
					}),
				),
			),
		[steps, workspace, inv?.report?.hypotheses],
	);
	const links = useMemo(
		() => runLinks(incident.alerts ?? [], inv?.report ?? null),
		[incident.alerts, inv?.report],
	);
	const fileOfStep = useCallback(
		(s: RunStep) => stepFile(s, workspace),
		[workspace],
	);
	const openStepFile = useCallback(
		(s: RunStep) => {
			const f = fileOfStep(s);
			if (f) openFile(f, `open-step-${s.n}`);
		},
		[fileOfStep, openFile],
	);

	const jump = useCallback((n: number) => {
		// A citation that opens a step must find it: the work unfolds and stays open.
		setWorkOpen(true);
		setOpen((o) => new Set(o).add(n));
		setHighlight(n);
		window.clearTimeout(timer.current);
		timer.current = window.setTimeout(() => setHighlight(null), HIGHLIGHT_MS);
		const from = document.activeElement;
		window.setTimeout(() => {
			const el = document.getElementById(`step-${n}`);
			el?.scrollIntoView({ block: "center", behavior: "smooth" });
			// Focus follows to the step only if the reader has not moved it since, or it left with a closed sheet.
			if (document.activeElement === from || !from?.isConnected)
				el?.querySelector<HTMLElement>("[data-testid=step-toggle]")?.focus({
					preventScroll: true,
				});
		}, 60);
	}, []);
	useEffect(() => () => window.clearTimeout(timer.current), []);
	// The step is under the sheet on a phone: lift the sheet to show it.
	const jumpOut = useCallback(
		(n: number) => {
			if (phone) hidePanel();
			jump(n);
		},
		[phone, jump, hidePanel],
	);
	const previewOpener = useCallback(() => previewFrom.current, []);
	const onPreview = useCallback((open: boolean) => {
		if (open) previewFrom.current = null;
		setPreview(open);
	}, []);

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

	// A deep link to a file or a tab opens the panel it shows in.
	useEffect(() => {
		if ((viewing || search.panel) && !panel) setPanel(true);
		// biome-ignore lint/correctness/useExhaustiveDependencies: only a newly named file or tab opens the panel.
	}, [viewing?.repo, viewing?.path, search.panel]);

	const closePanel = useCallback(() => {
		hidePanel();
		window.setTimeout(() => toggleRef.current?.focus(), 0);
	}, [hidePanel]);
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
	}, [setPanel, setTab]);

	const report = inv?.report;
	const reportTitle =
		report && inv && !chat
			? `${name} concluded: ${reportOutcome(report.rootCause)}`
			: null;
	const transcriptReport = useMemo(
		() =>
			reportTitle && report
				? { title: reportTitle, summary: report.summary }
				: null,
		[reportTitle, report],
	);
	const toggleStep = useCallback(
		(n: number) =>
			setOpen((o) => {
				const next = new Set(o);
				if (!next.delete(n)) next.add(n);
				return next;
			}),
		[],
	);
	const flaggedSet = useMemo(() => new Set(flaggedAt.values()), [flaggedAt]);
	const transcriptSteps = useMemo(
		() => ({
			all: steps,
			open,
			onToggle: toggleStep,
			highlight,
			flagged: flaggedSet,
			onSeeFlag: seeFlag,
			asks: run.asks,
			fileOf: fileOfStep,
			onOpenFile: openStepFile,
		}),
		[
			steps,
			open,
			toggleStep,
			highlight,
			flaggedSet,
			seeFlag,
			run.asks,
			fileOfStep,
			openStepFile,
		],
	);
	const toggleWork = useCallback(() => setWorkOpen((o) => !o), []);
	const workedSeconds =
		transcriptReport && !live && steps.length > 0 && inv && runTimed(inv)
			? runElapsed(inv, now)
			: null;
	const worked = useMemo(
		() =>
			workedSeconds !== null
				? {
						seconds: workedSeconds,
						steps: steps.length,
						open: workOpen,
						onToggle: toggleWork,
					}
				: null,
		[workedSeconds, steps.length, workOpen, toggleWork],
	);
	const targetOf = useCallback(
		(e: Parameters<typeof evidenceStep>[0]): CiteTarget | null => {
			const file = citedFile(e.source, workspace);
			if (file) return { file };
			const step = evidenceStep(e, steps);
			return step ? { step } : null;
		},
		[workspace, steps],
	);
	const afterReport = useMemo(
		() =>
			report && inv ? (
				<HypothesesCard
					report={report}
					at={inv.completedAt ?? null}
					targetOf={targetOf}
					onOpenFile={openFile}
					onJump={jumpOut}
					preview={preview}
					onPreview={onPreview}
					returnTo={previewOpener}
				/>
			) : null,
		[
			report,
			inv,
			targetOf,
			openFile,
			jumpOut,
			preview,
			onPreview,
			previewOpener,
		],
	);
	const fidelity =
		report?.fidelity?.harness === who.id ? report.fidelity : undefined;
	const substituted = !!fidelity && modelSubstituted(fidelity);
	const asked = fidelity?.model ? modelName(harness, fidelity.model) : null;
	const version = fidelity?.harnessVersion ? ` ${fidelity.harnessVersion}` : "";
	const usage = usageView(inv?.usage, {
		live,
		handedOff: handedOff(run.events),
	});
	// The chip's existing hint carries usage, naming no model; nothing reported adds nothing (ruling 13).
	const usageHint = usage.hint ? ` ${usage.hint}` : "";
	const modelChip: StripChip | null = inv
		? {
				text: substituted ? `${who.model}, asked ${asked}` : cap(who.model),
				title: substituted
					? `${who.agent}${version}. You asked for ${asked}; the agent reported ${who.model}.${usageHint}`
					: `${who.agent}${version} running ${who.model}.${usageHint}`,
				warn: substituted,
			}
		: null;
	const code = codeChip(inv?.workspace);
	const turns = toolTurns(run.events);
	const tools = toolsStatus(turns, {
		loading: run.eventsLoading,
		error: run.eventsError,
		live,
	});
	const preRun = inv?.preRun ?? null;
	const toolsHint =
		inv && harness?.toolsHint
			? {
					text: harness.toolsHint.text,
					folder: runsFolder(inv.workspace?.cwd),
				}
			: null;
	// A chat has no five steps, but its tools warning needs the same explanation (0.5.3 walk W11).
	const overview =
		inv && chat ? (
			<div className="mb-4">
				<RunToolsSection status={tools} turns={turns} hint={toolsHint} />
			</div>
		) : (
			inv && (
				<RunOverview
					steps={overviewSteps({
						snapshot: snapshotLine(preRun),
						code: codeLine(inv.workspace, preRun?.checkoutsSkipped ?? []),
						agent: harness?.label ?? who.agent,
						status: tools,
					})}
					status={tools}
					turns={turns}
					hint={toolsHint}
				/>
			)
		);
	const toolsChip: StripChip | null =
		tools.state === "not-reached"
			? {
					text: "Tools: not connected",
					title:
						"PrismaLens's tools did not reach the agent; the details say what to do.",
					warn: true,
				}
			: null;
	// A phone hides the strip's chips; a warning among them rides on the details toggle.
	const hiddenWarns = phone
		? [modelChip, code, toolsChip].flatMap((c) => (c?.warn ? [c.text] : []))
		: [];
	const recheck = useRecheck();
	const header = (
		<IncidentHeader
			incident={incident}
			view={draft ? "New conversation" : inv ? name : "Run"}
			reportRunId={report ? inv?.id : null}
			onResolve={record.openClose}
			onReopen={record.openReopen}
			onEditCause={record.openEditCause}
			onInvestigateAgain={
				recheck
					? () =>
							recheck().catch((error: unknown) =>
								toast({
									title: "Run not started",
									description: getErrorMessage(error),
									variant: "destructive",
								}),
							)
					: null
			}
			trailing={
				inv && !draft ? (
					<DetailsToggle
						ref={toggleRef}
						open={panel}
						onToggle={() => (panel ? closePanel() : setPanel(true))}
						title={chat ? "Question details" : "Run details"}
						flagged={flaggedCount}
						warns={hiddenWarns}
					/>
				) : null
			}
		/>
	);

	if (draft) return <DraftPage record={record} header={header} />;

	const step = runStepText(run.events, now ?? Date.now(), {
		streamLost: run.streamFailed,
	});
	const ask = run.asks.find((a) => a.state === "waiting");
	const stateWord = stripWords(
		inv,
		run.state,
		run.latestText ?? (step ? cap(step.text) : null),
		name,
		now,
		who.agent,
		run.awaiting
			? `${who.agent} asks to run ${ask ? askTitle(ask) : "a tool"}`
			: null,
	);

	const viewingRepo = viewing
		? workspace?.repos.find((r) => r.name === viewing.repo)
		: undefined;

	return (
		<div className="flex h-full min-h-0" data-testid="run-page">
			<div className="flex min-w-0 flex-1 flex-col">
				{header}
				<RunStrip
					state={run.state}
					waiting={run.awaiting}
					label={stateWord.label}
					detail={stateWord.detail}
					model={modelChip}
					code={panel ? null : code}
					tools={panel ? null : toolsChip}
					onStop={
						live ? () => run.stop({ onError: stopFailed(toast) }) : undefined
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
							cwd={cwd}
							agent={who.agent}
							runName={name}
							briefBy={
								startedBy(inv.triggerType) === "you" ? "You" : "PrismaLens"
							}
							report={transcriptReport}
							worked={worked}
							afterReport={afterReport}
							steps={transcriptSteps}
						/>
					)}
				</div>
				{/* Not while the run loads: the key turns from "none" to its id and the remount drops typed text (#807). */}
				{!run.isLoading && (
					<DockedComposer key={inv?.id ?? "none"} onStep={jump} />
				)}
			</div>
			<RightPanel
				open={panel && !!inv}
				label={chat ? "Question details" : `${name} details`}
				onClose={closePanel}
			>
				{inv && (
					<RunDetailsPanel
						title={chat ? "Question details" : `${name} details`}
						tab={tab}
						onTab={setTab}
						onClose={closePanel}
						incidentId={incident.id}
						summaryTop={
							<>
								{overview}
								{!live && <KeptWorkspaces runId={inv.id} />}
							</>
						}
						contextTop={
							!chat && (
								<RunRunbooks
									runId={inv.id}
									preRun={preRun}
									loadError={!!run.error}
								/>
							)
						}
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
						evidence={evidenceSections(inv, (e) => evidenceStep(e, steps), {
							live,
							standing: standingRun(record, inv.id),
							fileOf: (source) => citedFile(source, workspace),
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
						onJump={jumpOut}
						files={{
							runId: inv.id,
							workspace,
							touched,
							links,
							viewing,
							onOpen: openFile,
							onClose: closeFile,
							backLabel: origin.current?.id.startsWith("open-step-")
								? "Back to the step"
								: origin.current?.id.startsWith("steps-row-")
									? "Back to steps"
									: "Back to citation",
							reads: viewing ? readsOf(viewing, steps, workspace) : [],
							codeHost:
								viewing && viewingRepo
									? codeHostUrl(viewingRepo, viewing)
									: null,
							stepFile: fileOfStep,
							onOpenHypotheses: (from) => {
								previewFrom.current = from;
								setPreview(true);
							},
						}}
					/>
				)}
			</RightPanel>
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
	warns,
}: {
	ref: React.Ref<HTMLButtonElement>;
	open: boolean;
	onToggle: () => void;
	title: string;
	flagged: number;
	/** Warnings the strip cannot show on a phone. */
	warns: string[];
}) {
	const label = [
		title,
		...(flagged > 0
			? [`${flagged} flagged ${flagged === 1 ? "item" : "items"}`]
			: []),
		...warns,
	].join(", ");
	return (
		<Hint label={label}>
			<button
				ref={ref}
				type="button"
				aria-label={label}
				aria-pressed={open}
				id="details-toggle"
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
				{warns.length > 0 && !open && (
					<span
						aria-hidden
						className={cn(
							"absolute top-[3px] size-[7px] rounded-full bg-warn",
							flagged > 0 ? "right-[12px]" : "right-[3px]",
						)}
						data-testid="details-warn"
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
	/** What the agent waits on you for, while it does (#673 w5-14). */
	asking: string | null,
): { label: string; detail: string } {
	if (!inv || !state) return { label: name, detail: "" };
	const chat = inv.kind === "chat";
	const who = chat ? "Ask" : name;
	if (asking && isRunStateLive(state))
		return {
			label: chat ? "Ask, waiting for you" : `${who} waiting for you`,
			detail: asking,
		};
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
		case "failed": {
			const ago = when(inv.completedAt ?? inv.updatedAt);
			if (inv.endReason === "limited")
				return {
					label: chat ? "Ask, limited" : `${who} limited`,
					detail: [`${agent} reached its usage limit`, ago]
						.filter(Boolean)
						.join(", "),
				};
			if (inv.endReason === "interrupted")
				return {
					label: chat ? "Ask, interrupted" : `${who} interrupted`,
					detail: ["PrismaLens restarted", ago].filter(Boolean).join(", "),
				};
			return {
				label: chat ? "Ask, failed" : `${who} failed`,
				detail: failureStatusLine(agent, inv.error),
			};
		}
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
	const ended = state === "failed" ? endReasonStatus(inv, ctx.agent) : null;
	const status: SummaryFacts["status"] = ended
		? { ...ended, tone: "warn" }
		: state === "failed"
			? {
					text: "Failed",
					tone: "danger",
					sub: failureStatusLine(ctx.agent, inv.error),
				}
			: state === "stopped"
				? { text: "Stopped by you" }
				: live && run.awaiting
					? { text: "Waiting for your approval", tone: "warn" }
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
		usage: usageView(inv.usage, { live, handedOff: handedOff(run.events) }),
		access: level
			? {
					text: ACCESS_LEVEL_LABEL[level],
					sub: [
						asked && ran && asked !== ran
							? `Asked for ${ACCESS_LEVEL_LABEL[asked]}; the agent ran ${ACCESS_LEVEL_LABEL[ran]}.`
							: ACCESS_LEVEL_LINE[level],
						// #818 w5-29: how the run started decides its level.
						f?.unattended
							? "An alert started it, so nobody was there to answer: past reading files, anything the agent asked was refused. A follow-up you send runs at your Permission setting."
							: null,
						sandboxLine(levelSandbox(ctx.harness, level)),
					]
						.filter(Boolean)
						.join(" "),
				}
			: null,
		chat,
	};
}

/** A failed run's status when its agent's usage limit or a restart ended it, in place of "Failed". */
function endReasonStatus(
	inv: InvestigationWithRelations,
	agent: string,
): { text: string; sub: string } | null {
	const can = !!inv.resumable || !!inv.continuable;
	if (inv.endReason === "limited")
		return {
			text: "Limited",
			sub: `${agent} reached its usage limit.${can ? " Send a message below to continue with another agent, or wait for the limit to reset." : ""}`,
		};
	if (inv.endReason === "interrupted")
		return {
			text: "Interrupted (PrismaLens restarted)",
			sub: `Its last command may or may not have completed.${can ? " Send a message below to continue, with any agent." : ""}`,
		};
	return null;
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
