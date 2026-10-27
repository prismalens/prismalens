// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import {
	HarnessRegistry,
	type HarnessTool,
} from "@prismalens/integrations/harness";
import type { RunbooksData } from "../runbooks.js";
import { type ArtifactsData, artifactTools } from "./artifacts.js";
import {
	type IncidentLookup,
	type InvestigationsQuery,
	knowledgeTools,
	type PastInvestigation,
} from "./knowledge.js";
import { type FindingsData, recordTools } from "./record.js";
import { runbookTools } from "./runbooks.js";

export type { ArtifactsData } from "./artifacts.js";
export type {
	IncidentLookup,
	IncidentView,
	InvestigationsQuery,
	PastInvestigation,
} from "./knowledge.js";
export type { FindingsData } from "./record.js";

/** What the tools read; the api answers from its own database. */
export interface GatewayToolData {
	searchInvestigations(q: InvestigationsQuery): Promise<PastInvestigation[]>;
	incident: IncidentLookup;
	runbooks: RunbooksData;
	findings: FindingsData;
	artifacts: ArtifactsData;
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
	])
		registry.register(tool);
	return registry.list();
}
