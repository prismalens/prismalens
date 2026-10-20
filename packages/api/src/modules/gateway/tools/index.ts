// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { SourceRegistry } from "@prismalens/integrations";
import type { RunbooksData } from "../runbooks.js";
import { failureReason, type QuerySources } from "../source-tools.js";
import { alertmanagerTools } from "./alertmanager.js";
import {
	type InvestigationsQuery,
	knowledgeTools,
	type PastInvestigation,
} from "./knowledge.js";
import { lokiTools } from "./loki.js";
import { prometheusTools } from "./prometheus.js";
import { runbookTools } from "./runbooks.js";

export type { InvestigationsQuery, PastInvestigation } from "./knowledge.js";

/** What the tools read; the api answers from its own database. */
export interface GatewayToolData {
	searchInvestigations(q: InvestigationsQuery): Promise<PastInvestigation[]>;
	runbooks: RunbooksData;
	querySources: QuerySources;
	now?: () => Date;
}

/** Every PrismaLens tool, registered through the read-only gate (#848). */
export function gatewayRegistry(data: GatewayToolData): SourceRegistry {
	const registry = new SourceRegistry(failureReason);
	for (const tool of [
		...knowledgeTools((q) => data.searchInvestigations(q)),
		...runbookTools(data.runbooks),
		...prometheusTools(data.querySources, data.now),
		...alertmanagerTools(data.querySources),
		...lokiTools(data.querySources, data.now),
	])
		registry.register(tool);
	return registry;
}
