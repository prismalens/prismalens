// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { defineSourceTool, type SourceTool } from "@prismalens/integrations";
import { z } from "zod";
import { RUNBOOK_CHARS, type RunbooksData } from "../runbooks.js";

export function runbookTools(data: RunbooksData): SourceTool[] {
	const base = {
		category: "knowledge",
		openWorld: false,
	} as const;
	return [
		defineSourceTool({
			...base,
			name: "runbooks_list",
			title: "Runbooks in the bound repos",
			description:
				"Runbooks found in the repositories bound to services, read at the commit this run saw: markdown under runbooks/ and docs/runbooks/, RUNBOOK*.md, and runbook links in catalog-info.yaml (links are returned as links, never fetched). Optionally for one service.",
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
		defineSourceTool({
			...base,
			name: "runbooks_read",
			title: "Read a runbook",
			description: `The markdown of a runbook runbooks_list returned, cut at ${RUNBOOK_CHARS} characters. Pass its path and service exactly as listed.`,
			input: z.object({
				path: z.string().trim().min(1).max(1_000),
				service: z.string().trim().min(1).max(200),
			}),
			run: async ({ path, service }, ctx) => {
				const r = await data.read(ctx.runId, path, service);
				return { value: r, ...(r.ok ? {} : { isError: true }) };
			},
		}),
	];
}
