// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { ARTIFACT_HTML_CHARS } from "@prismalens/contracts/schemas";
import {
	defineHarnessTool,
	fail,
	type HarnessTool,
} from "@prismalens/integrations/harness";
import { z } from "zod";
import { withRules } from "./rules.js";
import { ANYWHERE } from "./serves.js";

/** Where a published page goes: the run's own record, by the bearer's run. */
export interface ArtifactsData {
	publish(
		runId: string,
		page: { title: string; html: string },
	): Promise<{ id: string } | { error: string; ended?: true }>;
}

/** HTML pages the agent shows the operator in the run (#871): drawn sandboxed, never fetched. */
export function artifactTools(data: ArtifactsData): HarnessTool[] {
	return [
		defineHarnessTool({
			name: "artifact_publish",
			title: "Show the operator an HTML page",
			description: withRules(
				`Publish one self-contained HTML page into this run, for something prose shows badly: a table of findings, a timeline, a chart drawn in inline SVG. Inline CSS and SVG only: scripts do not run and nothing is fetched, so external images, fonts and links will not load. Up to ${ARTIFACT_HTML_CHARS} characters. The operator sees it where you published it and can open it larger. Use it for a table, a timeline or a chart.`,
				"prose or a report: answer in your message.",
			),
			group: "record",
			effect: "record",
			serves: ANYWHERE,
			input: z.object({
				title: z.string().trim().min(1).max(120),
				html: z.string().min(1).max(ARTIFACT_HTML_CHARS),
			}),
			run: async ({ title, html }, ctx) => {
				const r = await data.publish(ctx.runId, { title, html });
				if (!("error" in r)) return { value: { id: r.id, published: true } };
				return r.ended
					? fail("run_ended", r.error, "Stop publishing; finish your answer.")
					: fail(
							"invalid_input",
							r.error,
							"Put the rest in fewer pages, or in your report.",
						);
			},
		}),
	];
}
