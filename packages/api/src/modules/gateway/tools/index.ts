// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { SourceRegistry } from "@prismalens/integrations";
import type { RunbooksData } from "../runbooks.js";
import {
	type IncidentLookup,
	type InvestigationsQuery,
	knowledgeTools,
	type PastInvestigation,
} from "./knowledge.js";
import { runbookTools } from "./runbooks.js";

export type {
	IncidentLookup,
	IncidentView,
	InvestigationsQuery,
	PastInvestigation,
} from "./knowledge.js";

/** What the tools read; the api answers from its own database. */
export interface GatewayToolData {
	searchInvestigations(q: InvestigationsQuery): Promise<PastInvestigation[]>;
	incident: IncidentLookup;
	runbooks: RunbooksData;
}

/**
 * PrismaLens's harness tools, registered through the read-only gate. Data-access tools
 * come from the user's own agent setup, never from here (#848 ruling 2026-10-24).
 */
export function gatewayRegistry(data: GatewayToolData): SourceRegistry {
	const registry = new SourceRegistry(() => "the tool failed");
	for (const tool of [
		...knowledgeTools((q) => data.searchInvestigations(q), data.incident),
		...runbookTools(data.runbooks),
	])
		registry.register(tool);
	return registry;
}
