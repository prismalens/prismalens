// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { HarnessSelection } from "@prismalens/config";
/**
 * What one investigation run needs from the API, as functions, so the run is
 * testable without NestJS. Wired in dispatch.service.ts.
 */
import type {
	AccessLevel,
	HarnessId,
	ModelSource,
} from "@prismalens/config/harness";
import type {
	CanonicalEvent,
	LiveTurn,
	RunEndReason,
	TurnOutcome,
	WorkflowStatus,
} from "@prismalens/contracts";
import type {
	ContextPack,
	RunChoice,
	RunCredential,
	RunUsage,
} from "@prismalens/contracts/schemas";
import type { GatewayEntry, ResolvedConnector } from "@prismalens/engine";
import type { AgentRuntime } from "../../core/harness/harness.service.js";
import type {
	RepoSource,
	Snapshot,
} from "../../core/harness/repo-source.service.js";
import type { RunbookIndex } from "../../modules/gateway/gateway.service.js";
import type { SnapshotWindow } from "../../modules/integrations/source-query.js";
import type { TelemetrySnapshot } from "../../modules/integrations/telemetry-snapshot.service.js";
import type { InternalInvestigationResultDto } from "../../modules/investigations/dto/index.js";
import type { TimelineWrite } from "../../modules/timeline/timeline.service.js";
import type { RestartFacts } from "./restart-recovery.js";

/** An incident id, or the service a check with no incident is about (#979). */
export type RunSubject = string | { serviceId: string };

export interface IncidentRepo {
	/** "folder" or "url"; `url` holds the folder path for a folder. */
	sourceKind: RepoSource["kind"];
	url: string;
	defaultBranch: string | null;
	subPath: string | null;
	connectionId: string | null;
	/** The service that links it; one repo may come back once per service (#747). */
	serviceName: string;
}

export interface RunPorts {
	findInvestigation(id: string): Promise<{
		id: string;
		status: string;
		harness: string | null;
		model: string | null;
		/** The effort the run asked for; a follow-up asks for it again (#673 w52). */
		effort?: string | null;
		acpSessionId: string | null;
		/** JSON RunWorkspace. */
		workspace: string | null;
		/** A run is a thread (#673); absent on a row from before kinds. */
		kind?: string | null;
		/** Set once Stop was asked for; the run re-reads it to own its end (#673 w59). */
		stopRequestedAt?: Date | string | null;
		/** JSON InvestigationReport; a handoff carries it. */
		report?: string | null;
	} | null>;
	/** Every stored event of the run, in order; a handoff is built from them. */
	events(id: string): Promise<CanonicalEvent[]>;
	/**
	 * A handoff moved the thread to another session: the next follow-up loads
	 * that one, and the old session's usage is cleared (ruling 13).
	 */
	recordHandoff(
		id: string,
		to: {
			harness: HarnessId;
			model: string | null;
			effort: string | null;
			acpSessionId: string | null;
		},
	): Promise<void>;
	/**
	 * A status write. False when the row refused it (cancelled, Stop asked for,
	 * or gone): the caller then writes no timeline entry and delivers nothing.
	 */
	updateStatus(
		id: string,
		dto: {
			status: "running" | "failed" | "completed" | "cancelled";
			error?: string;
			harnessThreadId?: string;
			startedAt?: Date;
			harness?: string;
			model?: string;
			effort?: string;
			acpSessionId?: string;
			/** JSON RunWorkspace. */
			workspace?: string;
			/** The agent's own mode id PrismaLens set (#673 w21). */
			agentMode?: string;
			/** The run's level as asked (#673 w21 ruling 2026-10-10). */
			accessLevel?: AccessLevel;
			/** A follow-up `continue` ending: how its message ended (#673 w59). */
			lastTurnOutcome?: TurnOutcome;
			/** On `failed`: the agent hit a usage limit. */
			endReason?: RunEndReason;
		},
	): Promise<boolean>;
	/** A row claimed with no `liveTurn` (queued before the column) gets one (#673 w59). */
	initLiveTurn(id: string, turn: LiveTurn): Promise<void>;
	/** The end of a follow-up that is not a `continue` (#673 w59, DESIGN §3.3); false when refused. */
	settleFollowUp(
		id: string,
		end: {
			status: WorkflowStatus;
			completedAt: Date | null;
			error: string | null;
			lastTurnOutcome: TurnOutcome;
		},
		opts: { stopped: boolean },
	): Promise<boolean>;
	/**
	 * A follow-up's own status write: no report delivery, no telemetry, and
	 * `completedAt`/`error` exactly as given, so the row can be put back (#747).
	 */
	followUpStatus(
		id: string,
		state: {
			status?: WorkflowStatus;
			completedAt?: Date | null;
			error?: string | null;
			/** JSON RunWorkspace the follow-up rebuilt, with the credentials it used. */
			workspace?: string;
		},
	): Promise<void>;
	/**
	 * Keep the harness's session id so a follow-up can load it (#747). Its own
	 * write, not `updateStatus`, which would count a second run start.
	 */
	recordSession(id: string, acpSessionId: string): Promise<void>;
	/** Keep the harness's latest `usage_update`. Its own write, like `recordSession`. */
	recordUsage(id: string, usage: RunUsage): Promise<void>;
	/** The oldest ask the agent waits on, or null once none waits (#673 w21). Its own write, like `recordSession`. */
	markAwaitingApproval(id: string, since: Date | null): Promise<void>;
	/**
	 * The incident's newest run started after this one, with its `Run #N` and
	 * the commits it looked at; null when there is none, or it kept no workspace (#673 w27).
	 */
	newerRun(id: string): Promise<{
		number: number;
		heads: { name: string; head: string }[];
	} | null>;
	/** The highest stored event `seq`, or -1 when none (#747). */
	lastEventSeq(id: string): Promise<number>;
	appendEvents(id: string, events: CanonicalEvent[]): Promise<void>;
	clearEvents(id: string): Promise<void>;
	/** False when the row refused the result; the same rule as `updateStatus`. */
	writeResult(
		id: string,
		dto: InternalInvestigationResultDto,
	): Promise<boolean>;
	createTimelineEntry(dto: TimelineWrite): Promise<void>;
	/** Detect-and-report verdict plus the model and effort: the run's own, else Settings', per field (#673 w52). */
	resolveHarness(requested?: RunChoice): Promise<{
		selection: HarnessSelection;
		model?: string;
		modelSource?: ModelSource;
		/** The operator's effort for this harness (R4.2); absent means its own default. */
		effort?: string;
		/** The next run's level on this harness: Settings, the agent's own default, else PrismaLens's (#673 w21). */
		accessLevel?: AccessLevel;
		/** The model is one the operator added in Settings, Agent (#673 w57). */
		customModel?: boolean;
	}>;
	/** The agent's env, binary path and arguments from Settings → Agent (#907). */
	agentRuntime(id: HarnessId): Promise<AgentRuntime>;
	getIncident(id: string): Promise<Record<string, unknown> | null>;
	/** What happened on the incident while PrismaLens was stopped, for a restart's message (#981). */
	restartAlerts?(
		incidentId: string | null,
		since: Date,
		until: Date,
		stoppedAt: Date,
	): Promise<RestartFacts["alerts"]>;
	/**
	 * The repos of the incident's service, then of each service its alerts name,
	 * primary first. Not deduped. Empty means the run is unmapped.
	 */
	incidentRepos(incidentId: string): Promise<IncidentRepo[]>;
	/** The connectors (telemetry) available to the run. Implemented by ConnectorResolverService. */
	resolveConnectors(
		serviceId: string | undefined,
	): Promise<ResolvedConnector[]>;
	/**
	 * Host-assembled facts (ADR-0016 §5). Implemented by ContextPackService; null when the incident
	 * does not exist. A service check passes its service and gets no prior incidents (#979).
	 */
	contextPack(subject: RunSubject): Promise<ContextPack | null>;
	/** The pre-run fetch (#848 ruling 2026-10-24); each part is best effort and never fails the run. */
	preRun?: {
		/** Picked by the incident's services; the selection reads the database inside the run's telemetry budget. */
		telemetry(
			subject: RunSubject,
			window: SnapshotWindow,
			signal?: AbortSignal,
		): Promise<TelemetrySnapshot>;
		/** Read from the workspace the run recorded, so after `recordWorkspace`; titles and paths only. */
		runbooks(runId: string, signal?: AbortSignal): Promise<RunbookIndex>;
		/** Stores the run's snapshot, the source of truth its follow-ups read. */
		save(runId: string, snapshot: string): Promise<void>;
		/** The stored snapshot, or null when the run has none. */
		load(runId: string): Promise<string | null>;
	};
	/**
	 * Stored deployment events' commits for these services, newest first (#973):
	 * the panel's diff pairs the newest in the run's history with the one before it.
	 */
	deployments?(
		services: string[],
	): Promise<{ sha: string; name: string | null }[]>;
	/** The run's MCP gateway bearer (#848): leased before the agent starts, revoked however the run ends. */
	gateway?: {
		lease(runId: string, serverName: string): Promise<GatewayEntry | null>;
		revoke(runId: string): void;
	};
	/**
	 * The repo's committed HEAD, or commit `at`, at `dest` (a folder's worktree locked for
	 * `runId`, #918), under the credential the resolver picks (#673); `credential` is the one used.
	 */
	snapshotWith(
		ref: RepoRef,
		dest: string,
		signal?: AbortSignal,
		at?: string,
		runId?: string,
		onOutput?: (chunk: string) => void,
	): Promise<{ snap: Snapshot; credential: RunCredential }>;
}

/** A repo as the run knows it; the pick is read from the row by URL. */
export interface RepoRef {
	sourceKind: RepoSource["kind"];
	url: string;
	connectionId: string | null;
	defaultBranch?: string | null;
}
