// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { HarnessSelection } from "@prismalens/config";
/**
 * What one investigation run needs from the API, as functions, so the run is
 * testable without NestJS. Wired in dispatch.service.ts.
 */
import type { ModelSource } from "@prismalens/config/harness";
import type { CanonicalEvent } from "@prismalens/contracts";
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
}

export interface RunPorts {
	findInvestigation(id: string): Promise<{ id: string; status: string } | null>;
	updateStatus(
		id: string,
		dto: {
			status: "running" | "failed" | "completed" | "cancelled";
			error?: string;
			harnessThreadId?: string;
			startedAt?: Date;
		},
	): Promise<void>;
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
	/** The repos linked to the incident's service, primary first. Empty means the run is unmapped. */
	incidentRepos(incidentId: string): Promise<IncidentRepo[]>;
	/** A git token for the connection that discovered the repo, when one exists. */
	repoToken(connectionId: string): Promise<string | null>;
	/** A fresh clone of the source's committed HEAD into `dest`. */
	snapshot(
		src: RepoSource,
		dest: string,
		signal?: AbortSignal,
	): Promise<Snapshot>;
}
