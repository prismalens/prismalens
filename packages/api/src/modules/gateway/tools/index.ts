// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import {
	HarnessRegistry,
	type HarnessTool,
} from "@prismalens/integrations/harness";
import type { RunbooksData } from "../runbooks.js";
import { type ArtifactsData, artifactTools } from "./artifacts.js";
import { type IncidentRecordData, incidentTools } from "./incident.js";
import {
	type IncidentLookup,
	type InvestigationsQuery,
	knowledgeTools,
	type PastInvestigation,
} from "./knowledge.js";
import { type FindingsData, recordTools } from "./record.js";
import { type RunStatusLookup, runTools } from "./run.js";
import { runbookTools } from "./runbooks.js";
import { type ServiceLookup, serviceTools } from "./services.js";
import { type ThreadsData, threadTools } from "./threads.js";

export type { ArtifactsData } from "./artifacts.js";
export type {
	ChangeItem,
	IncidentRecordData,
	TimelineItem,
} from "./incident.js";
export type {
	IncidentLookup,
	IncidentView,
	InvestigationsQuery,
	PastInvestigation,
} from "./knowledge.js";
export type { FindingsData } from "./record.js";
export type { RunStatusLookup, RunStatusView } from "./run.js";
export type { ServiceLookup, ServiceView } from "./services.js";
export type {
	ThreadReport,
	ThreadSummary,
	ThreadsData,
	ThreadView,
} from "./threads.js";

/** What the tools read; the api answers from its own database. */
export interface GatewayToolData {
	searchInvestigations(q: InvestigationsQuery): Promise<PastInvestigation[]>;
	incident: IncidentLookup;
	runbooks: RunbooksData;
	findings: FindingsData;
	artifacts: ArtifactsData;
	threads: ThreadsData;
	incidentRecord: IncidentRecordData;
	service: ServiceLookup;
	runStatus: RunStatusLookup;
}

/**
 * PrismaLens's harness tools, through the registry's checks. Data-access tools come from
 * the user's own agent setup, never from here (#848 ruling 2026-10-24).
 */
export function gatewayTools(data: GatewayToolData): readonly HarnessTool[] {
	const registry = new HarnessRegistry();
	for (const tool of [
		...knowledgeTools((q) => data.searchInvestigations(q), data.incident),
		...runbookTools(data.runbooks),
		...recordTools(data.findings),
		...artifactTools(data.artifacts),
		...threadTools(data.threads),
		...incidentTools(data.incidentRecord),
		...serviceTools(data.service),
		...runTools(data.runStatus),
	])
		registry.register(tool);
	return registry.list();
}
