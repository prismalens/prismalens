// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { HarnessSelection } from "@prismalens/config";
/**
 * What one investigation run needs from the API, as functions, so the run is
 * testable without NestJS. Wired in dispatch.service.ts.
 */
import type { ModelSource } from "@prismalens/config/harness";
import type { CanonicalEvent, WorkflowStatus } from "@prismalens/contracts";
import type { ContextPack } from "@prismalens/contracts/schemas";
import type { ResolvedConnector } from "@prismalens/engine";
import type {
	RepoSource,
	Snapshot,
} from "../../core/harness/repo-source.service.js";
import type { InternalInvestigationResultDto } from "../../modules/investigations/dto/index.js";
import type { CreateTimelineEntryDto } from "../../modules/timeline/dto/index.js";

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
		acpSessionId: string | null;
		/** JSON RunWorkspace. */
		workspace: string | null;
	} | null>;
	updateStatus(
		id: string,
		dto: {
			status: "running" | "failed" | "completed" | "cancelled";
			error?: string;
			harnessThreadId?: string;
			startedAt?: Date;
			harness?: string;
			model?: string;
			acpSessionId?: string;
			/** JSON RunWorkspace. */
			workspace?: string;
		},
	): Promise<void>;
	/**
	 * A follow-up's own status write: no report delivery, no telemetry, and
	 * `completedAt`/`error` exactly as given, so the row can be put back (#747).
	 */
	followUpStatus(
		id: string,
		state: {
			status: WorkflowStatus;
			completedAt?: Date | null;
			error?: string | null;
		},
	): Promise<void>;
	/**
	 * Keep the harness's session id so a follow-up can load it (#747). Its own
	 * write, not `updateStatus`, which would count a second run start.
	 */
	recordSession(id: string, acpSessionId: string): Promise<void>;
	/** The highest stored event `seq`, or -1 when none (#747). */
	lastEventSeq(id: string): Promise<number>;
	appendEvents(id: string, events: CanonicalEvent[]): Promise<void>;
	clearEvents(id: string): Promise<void>;
	writeResult(id: string, dto: InternalInvestigationResultDto): Promise<void>;
	createTimelineEntry(dto: CreateTimelineEntryDto): Promise<void>;
	/** Detect-and-report verdict plus the operator's model choice, if any. */
	resolveHarness(): Promise<{
		selection: HarnessSelection;
		model?: string;
		modelSource?: ModelSource;
	}>;
	getIncident(id: string): Promise<Record<string, unknown> | null>;
	/**
	 * The repos of the incident's service, then of each service its alerts name,
	 * primary first. Not deduped. Empty means the run is unmapped.
	 */
	incidentRepos(incidentId: string): Promise<IncidentRepo[]>;
	/** A git token for the connection that discovered the repo, when one exists. */
	repoToken(connectionId: string): Promise<string | null>;
	/** The connectors (telemetry) available to the run. Implemented by ConnectorResolverService. */
	resolveConnectors(
		serviceId: string | undefined,
	): Promise<ResolvedConnector[]>;
	/** Host-assembled facts (ADR-0016 §5). Implemented by ContextPackService; null when the incident does not exist. */
	contextPack(incidentId: string): Promise<ContextPack | null>;
	/** A fresh clone of the source's committed HEAD, or of commit `at`, into `dest`. */
	snapshot(
		src: RepoSource,
		dest: string,
		signal?: AbortSignal,
		at?: string,
	): Promise<Snapshot>;
}
