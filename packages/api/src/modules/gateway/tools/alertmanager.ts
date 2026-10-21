// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { defineSourceTool, type SourceTool } from "@prismalens/integrations";
import { z } from "zod";
import {
	cap,
	LIMITS,
	type QuerySources,
	querySource,
	sourceArg,
} from "../source-tools.js";

export function alertmanagerTools(sources: QuerySources): SourceTool[] {
	return [
		defineSourceTool({
			name: "alertmanager_alerts",
			title: "Alertmanager alerts",
			description: `Alerts in a connected Alertmanager, active only by default. filter takes matchers like severity="critical". At most ${LIMITS.alerts}.`,
			input: z.object({
				filter: z.array(z.string().trim().min(1).max(200)).max(10).optional(),
				includeSilenced: z.boolean().default(false),
				source: sourceArg,
			}),
			category: "metrics",
			openWorld: true,
			run: ({ filter, includeSilenced, source }, ctx) => {
				const params = new URLSearchParams({
					active: "true",
					silenced: String(includeSilenced),
					inhibited: String(includeSilenced),
				});
				for (const f of filter ?? []) params.append("filter", f);
				return querySource(
					sources,
					ctx,
					"alertmanager",
					source,
					`api/v2/alerts?${params.toString()}`,
					{},
					(data) => {
						const { items, dropped } = cap(
							Array.isArray(data) ? data : [],
							LIMITS.alerts,
						);
						return {
							alerts: items,
							...(dropped ? { alertsDropped: dropped } : {}),
						};
					},
				);
			},
		}),
	];
}
