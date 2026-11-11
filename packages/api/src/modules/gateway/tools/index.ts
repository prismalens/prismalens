// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import {
	HarnessRegistry,
	type HarnessTool,
} from "@prismalens/integrations/harness";
import type { RunbooksData } from "../runbooks.js";
import { type ArtifactsData, artifactTools } from "./artifacts.js";
import { type AsksData, askTools } from "./asks.js";
import { type AttachmentsData, attachmentTools } from "./attachments.js";
import { type CronData, cronTools } from "./cron.js";
import { type HistoryData, historyTools } from "./history.js";
import { type IncidentRecordData, incidentTools } from "./incident.js";
import {
	type IncidentLookup,
	type InvestigationsQuery,
	knowledgeTools,
	type PastInvestigation,
} from "./knowledge.js";
import { type ProposalsData, proposeTools } from "./propose.js";
import { type FindingsData, recordTools } from "./record.js";
import { reportTools } from "./report.js";
import { type RunStatusLookup, runTools } from "./run.js";
import { runbookTools } from "./runbooks.js";
import { type ServiceLookup, serviceTools } from "./services.js";
import { type ThreadTreeData, threadTreeTools } from "./thread-tree.js";
import { type ThreadsData, threadTools } from "./threads.js";
import { type WatchesData, watchTools } from "./watches.js";

export type { ArtifactsData } from "./artifacts.js";
export {
	ASK_DOCK,
	type AsksData,
	ELICITING_AGENTS,
	TOOL_ASKS,
} from "./asks.js";
export type { AttachmentItem, AttachmentsData } from "./attachments.js";
export { CRON_JOBS, type CronData } from "./cron.js";
export type { HistoryData, PastFix, SimilarIncident } from "./history.js";
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
export type { ProposalsData } from "./propose.js";
export type { FindingsData } from "./record.js";
export type { RunStatusLookup, RunStatusView } from "./run.js";
export type { ServiceLookup, ServiceView } from "./services.js";
export type { ThreadTreeData } from "./thread-tree.js";
export type {
	ThreadReport,
	ThreadSummary,
	ThreadsData,
	ThreadView,
} from "./threads.js";
export { THREAD_WATCHES, type WatchesData } from "./watches.js";

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
	attachments: AttachmentsData;
	history: HistoryData;
	tree: ThreadTreeData;
	proposals: ProposalsData;
	asks: AsksData;
	watches: WatchesData;
	cron: CronData;
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
		...reportTools(),
		...attachmentTools(data.attachments),
		...historyTools(data.history),
		...threadTreeTools(data.tree),
		...proposeTools(data.proposals),
		...askTools(data.asks),
		...watchTools(data.watches),
		...cronTools(data.cron),
	])
		registry.register(tool);
	return registry.list();
}
