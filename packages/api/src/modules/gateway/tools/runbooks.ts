// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import {
	defineHarnessTool,
	fail,
	type HarnessTool,
} from "@prismalens/integrations/harness";
import { z } from "zod";
import { RUNBOOK_CHARS, type RunbooksData } from "../runbooks.js";

export function runbookTools(data: RunbooksData): HarnessTool[] {
	return [
		defineHarnessTool({
			name: "runbooks_list",
			title: "Runbooks in the bound repos",
			description:
				"Runbooks found in the repositories bound to services, read at the commit this run saw: markdown under runbooks/ and docs/runbooks/, RUNBOOK*.md, and runbook links in catalog-info.yaml (links are returned as links, never fetched). Optionally for one service.",
			group: "knowledge",
			effect: "read",
			input: z.object({
				service: z.string().trim().min(1).max(200).optional(),
			}),
			run: async ({ service }, ctx) => {
				const runbooks = await data.list(ctx.runId, service);
				return {
					value: runbooks.length
						? { runbooks }
						: { status: "not-configured", runbooks: [] },
				};
			},
		}),
		defineHarnessTool({
			name: "runbooks_read",
			title: "Read a runbook",
			description: `The markdown of a runbook runbooks_list returned, cut at ${RUNBOOK_CHARS} characters. Pass its path and service exactly as listed.`,
			group: "core",
			effect: "read",
			input: z.object({
				path: z.string().trim().min(1).max(1_000),
				service: z.string().trim().min(1).max(200),
			}),
			run: async ({ path, service }, ctx) => {
				const r = await data.read(ctx.runId, path, service);
				if (r.ok) return { value: r };
				return r.disabled
					? fail(
							"disabled",
							"Runbook discovery is turned off in PrismaLens.",
							"Do not retry; read the repository's own docs with your file tools.",
						)
					: fail(
							"not_found",
							r.error,
							"Call runbooks_list and pass a path and service exactly as it returned them.",
						);
			},
		}),
	];
}
